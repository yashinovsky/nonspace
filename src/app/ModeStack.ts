/** Mode ids from plan §8.2. The ModeStack implementation is owned by M0.2. */
export const MODE_IDS = [
  'boot',
  'title',
  'interlude',
  'jackIn',
  'matrix',
  'breach',
  'core',
  'simstim',
  'deckPanel',
  'flatline',
  'beach',
  'jackOut',
] as const;

export type ModeId = (typeof MODE_IDS)[number];
