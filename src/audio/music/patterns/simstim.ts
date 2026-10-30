import type { MusicPattern } from './types';

/** Music low-passed and distant; meat ambience leads elsewhere (§7.2 Simstim). */
export const simstimPattern: MusicPattern = {
  state: 'simstim',
  filterHz: 380,
  layers: [{ id: 'pad', gain: 0.28, steps: [] }],
};
