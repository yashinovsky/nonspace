import type { MusicPattern } from './types';

/** Pad drone + slow FM arpeggio, sparse (§7.2 Transit). */
export const transitPattern: MusicPattern = {
  state: 'transit',
  layers: [
    { id: 'pad', gain: 0.7, steps: [] },
    {
      id: 'arp',
      gain: 0.45,
      steps: [
        { step: 0, degree: 4, octave: 1, probability: 0.85, vel: 0.7 },
        { step: 8, degree: 6, octave: 1, probability: 0.55, vel: 0.5 },
      ],
    },
  ],
};
