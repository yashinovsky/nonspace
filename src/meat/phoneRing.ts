/**
 * Wintermute payphone (plan §3.8, §5.7). UK ringing cadence: 0.4 on, 0.2 off,
 * 0.4 on, 2.0 off. Dual-tone 400 + 450 Hz. Visual flash follows the same
 * envelope, well under 3 Hz.
 */

export const PHONE_ON_A = 0.4;
export const PHONE_GAP = 0.2;
export const PHONE_ON_B = 0.4;
export const PHONE_SILENCE = 2.0;
export const PHONE_CYCLE = PHONE_ON_A + PHONE_GAP + PHONE_ON_B + PHONE_SILENCE; // 3 s
export const PHONE_TONE_A = 400;
export const PHONE_TONE_B = 450;

/** True during the ringer's "on" half of the 3 s cycle. */
export function phoneSounding(time: number): boolean {
  const u = ((time % PHONE_CYCLE) + PHONE_CYCLE) % PHONE_CYCLE;
  if (u < PHONE_ON_A) return true;
  if (u < PHONE_ON_A + PHONE_GAP) return false;
  if (u < PHONE_ON_A + PHONE_GAP + PHONE_ON_B) return true;
  return false;
}

/** Peaks per second of the cadence (two 0.4 s bursts every 3 s). */
export function phoneFlashHz(): number {
  return 2 / PHONE_CYCLE;
}

export interface PhoneRingHook {
  /** Bind a running AudioContext (after a user gesture). */
  unlock(ctx: AudioContext): void;
  start(): void;
  stop(): void;
  /** Drive the visual from sim time even without audio. */
  sounding(time: number): boolean;
  readonly playing: boolean;
  dispose(): void;
}

/**
 * Optional Web Audio hook. Safe with no context (visual-only). Oscillators
 * are created on start() after unlock(); stop() tears them down.
 */
export function createPhoneRing(): PhoneRingHook {
  let ctx: AudioContext | null = null;
  let oscA: OscillatorNode | null = null;
  let oscB: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let playing = false;
  let origin = 0;
  let sub: number | null = null;

  const apply = (): void => {
    if (!ctx || !gain || !playing) return;
    const on = phoneSounding(ctx.currentTime - origin);
    const target = on ? 0.07 : 0;
    const g = gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(target, ctx.currentTime, 0.012);
  };

  const teardown = (): void => {
    if (typeof window !== 'undefined' && sub !== null) {
      window.clearInterval(sub);
      sub = null;
    }
    try {
      oscA?.stop();
    } catch {
      /* already stopped */
    }
    try {
      oscB?.stop();
    } catch {
      /* already stopped */
    }
    oscA?.disconnect();
    oscB?.disconnect();
    gain?.disconnect();
    oscA = null;
    oscB = null;
    gain = null;
  };

  const hook: PhoneRingHook = {
    unlock(audioCtx) {
      ctx = audioCtx;
    },
    start() {
      playing = true;
      origin = ctx?.currentTime ?? 0;
      if (!ctx || oscA) {
        return;
      }
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      oscA = ctx.createOscillator();
      oscB = ctx.createOscillator();
      oscA.type = 'sine';
      oscB.type = 'sine';
      oscA.frequency.value = PHONE_TONE_A;
      oscB.frequency.value = PHONE_TONE_B;
      oscA.connect(gain);
      oscB.connect(gain);
      oscA.start();
      oscB.start();
      apply();
      if (typeof window !== 'undefined') {
        sub = window.setInterval(apply, 50);
      }
    },
    stop() {
      playing = false;
      teardown();
    },
    sounding(time) {
      return playing && phoneSounding(time);
    },
    get playing() {
      return playing;
    },
    dispose() {
      hook.stop();
      ctx = null;
    },
  };
  return hook;
}
