import type { SfxId } from '../AudioEngine';

/**
 * Plan §7.3 recipes mapped onto `SfxId` (plus the looping beam hiss, which is
 * not a one-shot). Lab buttons and the catalog coverage test use this list.
 */
export const SFX_PALETTE = [
  { recipe: 'Trode click / jack-in', id: 'jackIn' },
  { recipe: 'Flight wind', id: 'flightWind' },
  { recipe: 'Boost', id: 'boost' },
  { recipe: 'Coordinate jump', id: 'jump' },
  { recipe: 'Scan', id: 'scan' },
  { recipe: 'Hull contact', id: 'hullContact' },
  { recipe: 'Lock meter', id: 'lockStep' },
  { recipe: 'Re-key telegraph', id: 'rekeyTelegraph' },
  { recipe: 'Shatter', id: 'shatter' },
  { recipe: 'Trace ticks', id: 'traceTick' },
  { recipe: 'Burned', id: 'burned' },
  { recipe: 'CRT collapse (jack-out)', id: 'jackOut' },
  { recipe: 'Flatline', id: 'flatline' },
  { recipe: 'Simstim flip', id: 'simstimFlip' },
  { recipe: 'Kuang', id: 'kuang' },
  { recipe: 'Wintermute hijack', id: 'wintermuteHijack' },
  { recipe: 'Neuromancer softening', id: 'neuromancerSoften' },
] as const;

export type PaletteEntry = (typeof SFX_PALETTE)[number];
export type PaletteId = PaletteEntry['id'];

/** Extra one-shots already on the §9.7 `SfxId` list (arrival, sting, UI). */
export const EXTRA_SFX_IDS = [
  'gridTick',
  'jumpArrive',
  'kuangSting',
  'deckError',
  'uiClick',
] as const satisfies readonly SfxId[];
