import { hashString } from '../core/hash';
import { Pcg32 } from '../core/rng';
import { createNoiseBuffer } from './voices/Drums';

/**
 * Dixie Flatline voice (plan §7.5): SAM / Speak & Spell-flavoured chirps
 * through a formant bank, then bitcrush + ring mod. Laugh is gated noise
 * bursts with no inhale.
 */

export const VOWELS = ['i', 'I', 'e', 'ae', 'a', 'o', 'u', 'schwa'] as const;
export type Vowel = (typeof VOWELS)[number];

/** F1, F2, F3 in Hz. */
export const FORMANTS: Record<Vowel, readonly [number, number, number]> = {
  i: [270, 2290, 3010],
  I: [390, 1990, 2550],
  e: [530, 1840, 2480],
  ae: [660, 1720, 2410],
  a: [730, 1090, 2440],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  schwa: [500, 1500, 2500],
};

export interface Phoneme {
  vowel: Vowel;
  f0: number;
  dur: number;
}

export function barkPlan(lineId: string): Phoneme[] {
  const rng = new Pcg32(hashString(lineId, 0xdf1e), 1);
  const n = 3 + rng.below(4);
  const phones: Phoneme[] = [];
  let f0 = 88 + rng.next() * 36;
  for (let i = 0; i < n; i++) {
    phones.push({
      vowel: VOWELS[rng.below(VOWELS.length)]!,
      f0,
      dur: 0.045 + rng.next() * 0.07,
    });
    f0 *= 0.9 + rng.next() * 0.2;
  }
  return phones;
}

export interface LaughBurst {
  start: number;
  dur: number;
  amp: number;
}

/** Breathless rasp: short bursts, gaps too tight for an inhale, falling amp. */
export function laughPlan(seed = 0x1a0f): LaughBurst[] {
  const rng = new Pcg32(seed >>> 0, 7);
  const n = 6 + rng.below(4);
  const bursts: LaughBurst[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const dur = 0.035 + rng.next() * 0.04;
    bursts.push({ start: t, dur, amp: 0.22 * Math.pow(0.82, i) });
    t += dur + 0.03 + rng.next() * 0.04;
  }
  return bursts;
}

function bitcrushCurve(bits: number): Float32Array {
  const n = 256;
  const steps = 1 << bits;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * (steps / 2)) / (steps / 2);
  }
  return curve;
}

export interface DixieVoice {
  bark(lineId: string): void;
  laugh(): void;
  dispose(): void;
}

export function createDixieVoice(
  ctx: AudioContext,
  dest: AudioNode,
  noise?: AudioNode,
): DixieVoice {
  const crush = ctx.createWaveShaper();
  crush.curve = bitcrushCurve(4) as WaveShaperNode['curve'];
  crush.oversample = 'none';
  const ring = ctx.createGain();
  ring.gain.value = 0;
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'sine';
  ringOsc.frequency.value = 55;
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  crush.connect(ring);
  crush.connect(dry);
  ring.connect(dest);
  dry.connect(dest);
  ringOsc.connect(ring.gain);
  ringOsc.start();

  let ownedNoise: AudioBufferSourceNode | null = null;
  let noiseNode = noise;
  if (!noiseNode) {
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, 1);
    src.loop = true;
    src.start();
    ownedNoise = src;
    noiseNode = src;
  }

  const formants = [0, 1, 2].map(() => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    return bp;
  });

  const buzz = ctx.createOscillator();
  const buzzGain = ctx.createGain();
  buzz.type = 'sawtooth';
  buzz.frequency.value = 100;
  buzzGain.gain.value = 0;
  buzz.connect(buzzGain);
  for (const bp of formants) {
    buzzGain.connect(bp);
    bp.connect(crush);
  }
  buzz.start();

  const laughFilter = ctx.createBiquadFilter();
  laughFilter.type = 'bandpass';
  laughFilter.frequency.value = 1400;
  laughFilter.Q.value = 1.4;
  const laughAmp = ctx.createGain();
  laughAmp.gain.value = 0;
  noiseNode.connect(laughFilter);
  laughFilter.connect(laughAmp).connect(crush);

  return {
    bark(lineId) {
      const phones = barkPlan(lineId);
      const t0 = ctx.currentTime;
      let t = t0;
      buzzGain.gain.cancelScheduledValues(t0);
      buzz.frequency.cancelScheduledValues(t0);
      for (const bp of formants) bp.frequency.cancelScheduledValues(t0);
      ringOsc.frequency.setTargetAtTime(48 + (phones[0]?.f0 ?? 100) * 0.3, t0, 0.02);
      for (const ph of phones) {
        const [f1, f2, f3] = FORMANTS[ph.vowel];
        buzz.frequency.setValueAtTime(ph.f0, t);
        formants[0]!.frequency.setTargetAtTime(f1, t, 0.01);
        formants[1]!.frequency.setTargetAtTime(f2, t, 0.01);
        formants[2]!.frequency.setTargetAtTime(f3, t, 0.01);
        buzzGain.gain.setValueAtTime(0.0001, t);
        buzzGain.gain.linearRampToValueAtTime(0.18, t + 0.008);
        buzzGain.gain.setValueAtTime(0.18, t + ph.dur - 0.01);
        buzzGain.gain.linearRampToValueAtTime(0.0001, t + ph.dur);
        t += ph.dur + 0.012;
      }
    },
    laugh() {
      const bursts = laughPlan((Math.random() * 0xffffffff) >>> 0);
      const t0 = ctx.currentTime;
      laughAmp.gain.cancelScheduledValues(t0);
      laughAmp.gain.setValueAtTime(0, t0);
      laughFilter.frequency.setValueAtTime(1600, t0);
      laughFilter.frequency.exponentialRampToValueAtTime(700, t0 + 0.7);
      ringOsc.frequency.setTargetAtTime(38, t0, 0.02);
      for (const b of bursts) {
        const on = t0 + b.start;
        laughAmp.gain.setValueAtTime(0, on);
        laughAmp.gain.linearRampToValueAtTime(b.amp, on + 0.004);
        laughAmp.gain.setValueAtTime(b.amp, on + b.dur);
        laughAmp.gain.linearRampToValueAtTime(0, on + b.dur + 0.008);
      }
    },
    dispose() {
      const t = ctx.currentTime;
      buzzGain.gain.setValueAtTime(0, t);
      laughAmp.gain.setValueAtTime(0, t);
      try {
        buzz.stop(t + 0.05);
        ringOsc.stop(t + 0.05);
        ownedNoise?.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      crush.disconnect();
    },
  };
}
