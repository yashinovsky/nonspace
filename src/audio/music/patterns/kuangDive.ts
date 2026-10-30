import type { MusicPattern } from './types';

/** Full drum pattern, 128 BPM, rising (§7.2 Kuang dive). */
export const kuangDivePattern: MusicPattern = {
  state: 'kuangDive',
  bpm: 128,
  layers: [
    { id: 'pad', gain: 0.25, steps: [] },
    {
      id: 'bass',
      gain: 0.7,
      steps: [
        { step: 0, degree: 0, octave: -1, probability: 1, vel: 1 },
        { step: 6, degree: 0, octave: -1, probability: 0.6, vel: 0.6 },
        { step: 8, degree: 0, octave: -1, probability: 1, vel: 0.9 },
        { step: 14, degree: 4, octave: -1, probability: 0.5, vel: 0.55 },
      ],
    },
    {
      id: 'kick',
      gain: 1,
      steps: [
        { step: 0, probability: 1, vel: 1 },
        { step: 4, probability: 1, vel: 0.85 },
        { step: 8, probability: 1, vel: 1 },
        { step: 12, probability: 1, vel: 0.85 },
      ],
    },
    {
      id: 'snare',
      gain: 0.85,
      steps: [
        { step: 4, probability: 1, vel: 1 },
        { step: 12, probability: 1, vel: 1 },
      ],
    },
    {
      id: 'hats',
      gain: 0.7,
      steps: Array.from({ length: 16 }, (_, step) => ({
        step,
        probability: 1,
        vel: step % 2 === 0 ? 0.55 : 0.3,
        open: step === 14,
      })),
    },
  ],
};
