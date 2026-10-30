import type { MusicPattern } from './types';

/** Transit layers plus pulse bass + hats (§7.2 Approach). */
export const approachPattern: MusicPattern = {
  state: 'approach',
  layers: [
    { id: 'pad', gain: 0.5, steps: [] },
    {
      id: 'arp',
      gain: 0.35,
      steps: [
        { step: 0, degree: 4, octave: 1, probability: 1, vel: 0.65 },
        { step: 4, degree: 2, octave: 1, probability: 0.5, vel: 0.4 },
        { step: 8, degree: 6, octave: 1, probability: 0.8, vel: 0.55 },
        { step: 12, degree: 4, octave: 1, probability: 0.4, vel: 0.35 },
      ],
    },
    {
      id: 'bass',
      gain: 0.85,
      steps: [
        { step: 0, degree: 0, octave: -1, probability: 1, vel: 1 },
        { step: 4, degree: 0, octave: -1, probability: 1, vel: 0.75 },
        { step: 8, degree: 0, octave: -1, probability: 1, vel: 0.95 },
        { step: 12, degree: 3, octave: -1, probability: 0.7, vel: 0.7 },
      ],
    },
    {
      id: 'hats',
      gain: 0.55,
      steps: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({
        step,
        probability: 0.9,
        vel: step % 4 === 0 ? 0.7 : 0.4,
      })),
    },
  ],
};
