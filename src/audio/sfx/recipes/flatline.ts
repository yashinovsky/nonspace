import { gainOf, playOsc, sfxDest, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/**
 * Timed to the §5.9 visual (4 s): EEG beeps → 1 kHz monitor tone through the
 * CRT collapse + 2 s lingering dot → hard silence. Visuals (even stubs) should
 * use `flatlinePhaseAt` / `FLATLINE_TIMING` so audio and picture stay locked.
 */
export const FLATLINE_TIMING = {
  beepCount: 3,
  beepStarts: [0, 0.32, 0.64] as const,
  beepDur: 0.08,
  beepHz: 1000,
  toneHz: 1000,
  toneStart: 0.9,
  collapseStart: 0.9,
  collapseDur: 0.9,
  lingerDur: 2.0,
  silenceAt: 3.8,
  total: 4.0,
} as const;

export type FlatlinePhase = 'idle' | 'beeps' | 'tone' | 'linger' | 'silence' | 'done';

export function flatlinePhaseAt(elapsed: number): FlatlinePhase {
  if (elapsed < 0) return 'idle';
  const T = FLATLINE_TIMING;
  if (elapsed < T.toneStart) return 'beeps';
  if (elapsed < T.toneStart + T.collapseDur) return 'tone';
  if (elapsed < T.silenceAt) return 'linger';
  if (elapsed < T.total) return 'silence';
  return 'done';
}

export interface FlatlineHandle {
  /** AudioContext time when the sequence started, or 0. */
  t0: number;
  stop: () => void;
}

/**
 * Schedule the whole sequence on the audio clock. Returns a handle so the lab
 * (and later Flatline mode) can poll phase from `ctx.currentTime - t0`.
 */
export function playFlatline(world: SfxWorld, opts?: SfxOptions): FlatlineHandle {
  const ctx = world.ctx;
  const dest = sfxDest(world);
  const t0 = ctx.currentTime;
  const g = gainOf(opts);
  const T = FLATLINE_TIMING;

  for (const start of T.beepStarts) {
    playOsc(world, {
      type: 'sine',
      freq: T.beepHz,
      amp: 0.16 * g,
      attack: 0.002,
      decay: T.beepDur,
      when: t0 + start,
      dest,
    });
  }

  const tone = ctx.createOscillator();
  const toneGain = ctx.createGain();
  tone.type = 'sine';
  tone.frequency.value = T.toneHz;
  toneGain.gain.value = 0;
  tone.connect(toneGain).connect(dest);
  const toneOn = t0 + T.toneStart;
  const cut = t0 + T.silenceAt;
  toneGain.gain.setValueAtTime(0.0001, t0);
  toneGain.gain.setValueAtTime(0.0001, toneOn);
  toneGain.gain.linearRampToValueAtTime(0.14 * g, toneOn + 0.02);
  // Hard silence: no release, just a step to zero.
  toneGain.gain.setValueAtTime(0.14 * g, cut);
  toneGain.gain.setValueAtTime(0, cut);
  tone.start(toneOn);
  tone.stop(cut + 0.02);

  world.duck('music', -24, T.silenceAt);
  window.setTimeout(() => world.duck('all', -48, 1.2), Math.max(0, (cut - ctx.currentTime) * 1000));

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    toneGain.gain.cancelScheduledValues(now);
    toneGain.gain.setValueAtTime(0, now);
    try {
      tone.stop(now + 0.02);
    } catch {
      /* already stopped */
    }
  };

  tone.addEventListener('ended', () => {
    try {
      tone.disconnect();
      toneGain.disconnect();
    } catch {
      /* already gone */
    }
  });

  return { t0, stop };
}
