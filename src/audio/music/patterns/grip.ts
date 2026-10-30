import type { MusicPattern } from './types';

/** Music ducks −24 dB; sub-bass ring-mod growl + heartbeat (§7.2 Grip). */
export const gripPattern: MusicPattern = {
  state: 'grip',
  duckDb: -24,
  layers: [
    { id: 'growl', gain: 0.8, steps: [] },
    {
      id: 'heartbeat',
      gain: 1,
      steps: [
        { step: 0, probability: 1, vel: 1 },
        { step: 8, probability: 1, vel: 0.7 },
      ],
    },
  ],
};
