import { Pcg32 } from '../core/rng';

/**
 * Bell 103-style FSK (plan §7.4): originate 1070/1270 Hz, answer 2025/2225 Hz,
 * 300 baud, handshake chirps then full-duplex random bit streams, band-limited.
 */
export const BELL103 = {
  baud: 300,
  originate: { space: 1070, mark: 1270 },
  answer: { space: 2025, mark: 2225 },
  /** Seconds. */
  handshake: {
    chirpDur: 0.08,
    originateCarrier: 0.35,
    answerCarrier: 0.45,
    dataAt: 0.4,
  },
  lowpassHz: 2700,
  mixGain: 0.07,
  chunkBits: 256,
} as const;

export type FskChannel = 'originate' | 'answer';

export function fskFreq(channel: FskChannel, bit: 0 | 1): number {
  const pair = BELL103[channel];
  return bit ? pair.mark : pair.space;
}

export function bitDuration(baud = BELL103.baud): number {
  return 1 / baud;
}

/** Fill `out` with 0/1 bits from a PCG32 seed (testable, not Math.random). */
export function fillBits(out: Uint8Array, seed: number, stream = 0): void {
  const rng = new Pcg32(seed >>> 0, stream >>> 0);
  for (let i = 0; i < out.length; i++) out[i] = rng.below(2) as 0 | 1;
}

export function handshakeTimeline(): {
  chirpAt: number;
  originateCarrierAt: number;
  answerCarrierAt: number;
  dataAt: number;
} {
  const h = BELL103.handshake;
  return {
    chirpAt: 0,
    originateCarrierAt: 0,
    answerCarrierAt: 0.12,
    dataAt: h.dataAt,
  };
}

export interface ModemInfo {
  running: boolean;
  baud: number;
  originate: readonly [number, number];
  answer: readonly [number, number];
  /** Hz currently held on each carrier (mark during idle handshake). */
  live: { originate: number; answer: number };
}

export interface ModemVoice {
  start(): void;
  stop(): void;
  info(): ModemInfo;
  dispose(): void;
}

/**
 * Two oscillators (originate + answer), a handshake, then 300-baud FSK on both
 * with independent bitstreams. Mixed low through a 2.7 kHz low-pass.
 */
export function createModem(ctx: AudioContext, dest: AudioNode): ModemVoice {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = BELL103.lowpassHz;
  lp.Q.value = 0.7;
  const mix = ctx.createGain();
  mix.gain.value = 0;
  lp.connect(mix).connect(dest);

  const orig = ctx.createOscillator();
  const ans = ctx.createOscillator();
  orig.type = 'sine';
  ans.type = 'sine';
  orig.frequency.value = BELL103.originate.mark;
  ans.frequency.value = BELL103.answer.mark;
  const origGain = ctx.createGain();
  const ansGain = ctx.createGain();
  origGain.gain.value = 0.7;
  ansGain.gain.value = 0.55;
  orig.connect(origGain).connect(lp);
  ans.connect(ansGain).connect(lp);
  orig.start();
  ans.start();

  const bitDur = bitDuration();
  const chunk = new Uint8Array(BELL103.chunkBits);
  let running = false;
  let timer = 0;
  let seed = 0x103b311;
  let liveOrig: number = BELL103.originate.mark;
  let liveAns: number = BELL103.answer.mark;

  const scheduleChannel = (
    osc: OscillatorNode,
    channel: FskChannel,
    bits: Uint8Array,
    t0: number,
    stream: number,
  ): number => {
    fillBits(bits, seed++, stream);
    let last = -1;
    for (let i = 0; i < bits.length; i++) {
      const bit = bits[i] ? 1 : 0;
      if (bit === last) continue;
      last = bit;
      const f = fskFreq(channel, bit);
      osc.frequency.setValueAtTime(f, t0 + i * bitDur);
      if (i === bits.length - 1) {
        if (channel === 'originate') liveOrig = f;
        else liveAns = f;
      }
    }
    if (channel === 'originate') liveOrig = fskFreq(channel, bits[bits.length - 1] ? 1 : 0);
    else liveAns = fskFreq(channel, bits[bits.length - 1] ? 1 : 0);
    return t0 + bits.length * bitDur;
  };

  const pump = (): void => {
    if (!running) return;
    const t = ctx.currentTime + 0.02;
    scheduleChannel(orig, 'originate', chunk, t, 1);
    scheduleChannel(ans, 'answer', chunk, t, 2);
    const wait = chunk.length * bitDur * 1000 * 0.9;
    timer = window.setTimeout(pump, wait);
  };

  const handshake = (t: number): void => {
    const tl = handshakeTimeline();
    // Line-seize chirp: 500 → 2500 Hz on the originate carrier.
    orig.frequency.cancelScheduledValues(t);
    ans.frequency.cancelScheduledValues(t);
    orig.frequency.setValueAtTime(500, t + tl.chirpAt);
    orig.frequency.exponentialRampToValueAtTime(2500, t + tl.chirpAt + BELL103.handshake.chirpDur);
    orig.frequency.setValueAtTime(
      BELL103.originate.mark,
      t + tl.originateCarrierAt + BELL103.handshake.chirpDur + 0.01,
    );
    ans.frequency.setValueAtTime(BELL103.answer.mark, t + tl.answerCarrierAt);
    liveOrig = BELL103.originate.mark;
    liveAns = BELL103.answer.mark;
  };

  return {
    start() {
      const t = ctx.currentTime;
      if (running) return;
      running = true;
      handshake(t);
      mix.gain.cancelScheduledValues(t);
      mix.gain.setValueAtTime(mix.gain.value || 0.0001, t);
      mix.gain.linearRampToValueAtTime(BELL103.mixGain, t + 0.05);
      const dataAt = t + handshakeTimeline().dataAt;
      window.setTimeout(
        () => {
          if (running) pump();
        },
        Math.max(0, (dataAt - ctx.currentTime) * 1000),
      );
    },
    stop() {
      running = false;
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      const t = ctx.currentTime;
      orig.frequency.cancelScheduledValues(t);
      ans.frequency.cancelScheduledValues(t);
      mix.gain.cancelScheduledValues(t);
      mix.gain.setTargetAtTime(0.0001, t, 0.04);
    },
    info() {
      return {
        running,
        baud: BELL103.baud,
        originate: [BELL103.originate.space, BELL103.originate.mark],
        answer: [BELL103.answer.space, BELL103.answer.mark],
        live: { originate: liveOrig, answer: liveAns },
      };
    },
    dispose() {
      this.stop();
      try {
        orig.stop();
        ans.stop();
      } catch {
        /* already stopped */
      }
      mix.disconnect();
    },
  };
}
