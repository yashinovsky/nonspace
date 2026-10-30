/**
 * M5 forced-flatline handoff onto M6 "The Beach".
 *
 * Lazy — default boot never imports this module. After M5 PR #50 merged,
 * `campaign/kuangGrade.ts` `handoffBeach` calls `enterBeach({ source: 'm5' })`
 * instead of `createBeachMode()`. `?mission=m6` uses the same entry with
 * `source: 'm6'` (short teletext brief, then walking).
 */
export {
  enterBeach,
  startBeachMission,
  type BeachHandle,
  type BeachMission,
  type EnterBeachOptions,
  type EnterBeachSource,
} from './beach';
