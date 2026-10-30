import type { IceDef, IceLayerDef } from '../breach/IceModel';
import type { Difficulty } from '../core/settings';
import { HEAT_REKEY_PER_LEVEL } from '../deck/Heat';
import type { GateDef } from '../simstim/Gates';
import { DIFFICULTY, ICE_LAYER_PRESETS } from './ice/presets';

export { DIFFICULTY, ICE_LAYER_PRESETS };
export type { Difficulty };

/**
 * Settings use `story` (plan §8.8). M8.3 / the assignment call the same
 * preset Easy. Both names resolve to the Story column in §12.3.
 */
export type TuneDifficulty = Difficulty | 'easy';

export interface TuneOpts {
  difficulty?: TuneDifficulty;
  /** Campaign heat 0–3 (plan §3.6). Shortens re-key by `HEAT_REKEY_PER_LEVEL`. */
  heat?: number;
}

/** M2 starting gate windows (plan §12.3). */
export const GATE_WINDOWS = {
  early: 20,
  late: 15,
  exposurePerSec: 0.04,
  failAt: 1,
} as const;

/** Deck / watcher / core trace (plan §12.3). Burned at 100. */
export const TRACE_RATES = {
  hullContact: 2,
  watcherSweep: 6,
  coreInteriorMul: 1.5,
  burnedAt: 100,
} as const;

export function resolveDifficulty(difficulty: TuneDifficulty = 'normal'): Difficulty {
  return difficulty === 'easy' ? 'story' : difficulty;
}

export function difficultyMul(difficulty: TuneDifficulty = 'normal') {
  return DIFFICULTY[resolveDifficulty(difficulty)];
}

/** Re-key interval scale: difficulty × 1/(1 + 0.15·heat). */
export function rekeyScale(difficulty: TuneDifficulty = 'normal', heat = 0): number {
  const iceMul = difficultyMul(difficulty).rekeyInterval;
  const heatMul = 1 / (1 + HEAT_REKEY_PER_LEVEL * Math.max(0, heat));
  return iceMul * heatMul;
}

export function scaleRekeyEvery(
  every: readonly [number, number],
  opts: TuneOpts = {},
): [number, number] {
  const scale = rekeyScale(opts.difficulty, opts.heat);
  return [every[0] * scale, every[1] * scale];
}

export function campaignTuneOpts(
  settings: { readonly difficulty: Difficulty },
  save?: { data: { campaign: { heat?: number } } },
): TuneOpts {
  return { difficulty: settings.difficulty, heat: save?.data.campaign.heat ?? 0 };
}

/** Apply §12.3 difficulty + heat to one Normal-base layer. */
export function tuneLayer(layer: IceLayerDef, opts: TuneOpts = {}): IceLayerDef {
  const d = difficultyMul(opts.difficulty);
  const next = structuredClone(layer);
  next.tolRatio = layer.tolRatio * d.tolRatio;
  next.telegraph = layer.telegraph * d.telegraph;
  next.feedbackDps = layer.feedbackDps * d.feedbackDps;
  if (next.rekeyEvery) next.rekeyEvery = scaleRekeyEvery(next.rekeyEvery, opts);
  return next;
}

export function tuneIce(def: IceDef, opts: TuneOpts = {}): IceDef {
  return {
    ...def,
    layers: def.layers.map((layer) => tuneLayer(layer, opts)),
  };
}

export function tuneGateWindow(
  early: number,
  late: number,
  difficulty: TuneDifficulty = 'normal',
): { early: number; late: number } {
  const m = difficultyMul(difficulty).gateWindows;
  return { early: early * m, late: late * m };
}

export function tuneGate(gate: GateDef, difficulty: TuneDifficulty = 'normal'): GateDef {
  const w = tuneGateWindow(gate.early, gate.late, difficulty);
  return { ...gate, early: w.early, late: w.late };
}

export function tuneGates(
  gates: readonly GateDef[],
  difficulty: TuneDifficulty = 'normal',
): GateDef[] {
  return gates.map((gate) => tuneGate(gate, difficulty));
}
