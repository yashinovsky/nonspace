import type { MusicMode } from '../AudioEngine';

export const A4_MIDI = 69;
export const A4_HZ = 440;
/** Plan §9.11: default mission root is A2. */
export const DEFAULT_ROOT_MIDI = 45;
export const DEFAULT_MODE: MusicMode = 'minor';

/** Pitch-class offsets from the root. */
export const SCALE_DEGREES: Record<MusicMode, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/** Minor pentatonic (Mitsubishi bells, §7.2). */
export const PENTATONIC_MINOR = [0, 3, 5, 7, 10] as const;

export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(Math.max(1e-6, hz) / A4_HZ);
}

export function pitchClass(midi: number, root: number): number {
  const pc = (Math.round(midi) - Math.round(root)) % 12;
  return pc < 0 ? pc + 12 : pc;
}

export function isInKey(midi: number, root: number, mode: MusicMode): boolean {
  return SCALE_DEGREES[mode].includes(pitchClass(midi, root));
}

/**
 * Snap a MIDI note onto the nearest scale tone of `root`/`mode`.
 * Ties break upward so ICE overtones stay on the bright side of a split.
 */
export function nearestInKey(midi: number, root: number, mode: MusicMode): number {
  const scale = SCALE_DEGREES[mode];
  const centerOct = Math.floor((midi - root) / 12);
  let best = root;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let oct = centerOct - 1; oct <= centerOct + 1; oct++) {
    for (let i = 0; i < scale.length; i++) {
      const n = root + oct * 12 + scale[i]!;
      const d = Math.abs(n - midi);
      if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) < 1e-9 && n > best)) {
        bestDist = d;
        best = n;
      }
    }
  }
  return best;
}

export function quantizeHz(hz: number, root: number, mode: MusicMode): number {
  return midiToHz(nearestInKey(hzToMidi(hz), root, mode));
}

/** Scale degree 0 is the root; negative degrees walk below. */
export function degreeToMidi(degree: number, root: number, mode: MusicMode, octave = 0): number {
  const scale = SCALE_DEGREES[mode];
  const n = scale.length;
  const shifted = degree + octave * n;
  const oct = Math.floor(shifted / n);
  const i = ((shifted % n) + n) % n;
  return root + oct * 12 + scale[i]!;
}

export function degreeToHz(degree: number, root: number, mode: MusicMode, octave = 0): number {
  return midiToHz(degreeToMidi(degree, root, mode, octave));
}

export interface PhaseLockTones {
  /** Quantized ICE x-oscillator Hz. */
  iceA: number;
  /** Quantized ICE y-oscillator Hz. */
  iceB: number;
  /** Quantized player oscillator Hz. */
  player: number;
  /** f0 snapped onto the mission key. */
  f0: number;
}

/**
 * Map Phase Lock just-intonation partials (`a·f0`, `b·f0`) onto the mission
 * key so the breach tones agree with the adaptive music (M5.3 AC).
 */
export function phaseLockTones(
  a: number,
  b: number,
  f0: number,
  root: number,
  mode: MusicMode,
  R = 1,
): PhaseLockTones {
  const f0InKey = quantizeHz(Math.max(1, f0), root, mode);
  const iceA = quantizeHz(Math.max(1, a) * f0InKey, root, mode);
  const iceB = quantizeHz(Math.max(1, b) * f0InKey, root, mode);
  const player = quantizeHz(Math.min(4000, Math.max(1, R) * Math.max(1, a) * f0InKey), root, mode);
  return { iceA, iceB, player, f0: f0InKey };
}
