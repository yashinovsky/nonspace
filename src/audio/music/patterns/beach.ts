import type { MusicPattern } from './types';

/** No synth; procedural surf, wind, distant dub bassline (§7.2 Beach). */
export const beachPattern: MusicPattern = {
  state: 'beach',
  filterHz: 900,
  layers: [
    { id: 'surf', gain: 0.7, steps: [] },
    { id: 'wind', gain: 0.45, steps: [] },
    {
      id: 'dubBass',
      gain: 0.5,
      steps: [
        { step: 0, degree: 0, octave: -2, probability: 1, vel: 0.85 },
        { step: 12, degree: 0, octave: -2, probability: 0.6, vel: 0.5 },
      ],
    },
  ],
};
