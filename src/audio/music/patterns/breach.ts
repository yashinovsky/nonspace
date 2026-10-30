import type { MusicPattern } from './types';

/** Strip to drone; percussion follows lock meter (§7.2 Breach). */
export const breachPattern: MusicPattern = {
  state: 'breach',
  layers: [
    { id: 'drone', gain: 0.65, steps: [] },
    { id: 'pad', gain: 0.2, steps: [] },
    {
      id: 'hats',
      gain: 0.4,
      steps: [0, 4, 8, 12].map((step) => ({ step, probability: 1, vel: 0.5 })),
    },
    {
      id: 'kick',
      gain: 0.35,
      steps: [{ step: 0, probability: 1, vel: 0.8 }],
    },
  ],
};
