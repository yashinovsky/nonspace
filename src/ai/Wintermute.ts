/**
 * Wintermute behaviors from plan §3.8. The plan names the type but not its
 * shape; this union is provisional and owned by M7.3. Each action is
 * reversible: `on: false` / `amount: 0` restores the untouched state.
 */
export type WintermuteAction =
  | { kind: 'hijack'; text: string }
  | { kind: 'overexpose'; amount: number; seconds?: number }
  | { kind: 'freeze'; on: boolean }
  | { kind: 'gridBend'; points: Array<{ x: number; z: number; strength: number }> }
  | { kind: 'persona'; who: string; on: boolean }
  | { kind: 'ringPhones'; on: boolean }
  | { kind: 'bargain'; offerId: string; debt: number };

/** Upper bound on warp control points the grid shader accepts (plan §8.5). */
export const MAX_GRID_BEND_POINTS = 4;
