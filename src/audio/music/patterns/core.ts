import type { MusicPattern } from './types';

/** Choir-like pad, tape-like wow (filter); modem sits on sfx (§7.2 Core). */
export const corePattern: MusicPattern = {
  state: 'core',
  filterHz: 2200,
  layers: [
    { id: 'choir', gain: 0.75, steps: [] },
    { id: 'pad', gain: 0.35, steps: [] },
  ],
};
