import type { MusicMode } from '../AudioEngine';

/** Scale degrees in semitones from the key root (plan §7.2 modes). */
export const MODE_DEGREES: Record<MusicMode, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** `degree` walks the mode (can be negative or past one octave). */
export function degreeHz(root: number, mode: MusicMode, degree: number, octave = 0): number {
  const scale = MODE_DEGREES[mode];
  const n = scale.length;
  const shifted = degree + octave * n;
  const oct = Math.floor(shifted / n);
  const i = ((shifted % n) + n) % n;
  return midiToHz(root + scale[i]! + oct * 12);
}

export function hz(freq: number, pitch: number): number {
  return Math.max(20, freq * (pitch || 1));
}
