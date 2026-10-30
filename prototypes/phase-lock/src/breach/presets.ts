import type { Ratio } from './PhaseLock';

/** Mirrors `IceLayerDef` in plan §9.3. */
export interface IceLayerDef {
  ratios: Ratio[];
  tolRatio: number;
  /** rad/s of figure phase */
  phaseDrift: number;
  rekeyEvery?: [number, number];
  telegraph: number;
  lockTime: number;
  /** %/s while engaged */
  traceRate: number;
  /** neural/s while m < 0.3 */
  feedbackDps: number;
  grip?: {
    neuralThreshold: number;
    seconds: number;
    /** keep re-keying during the grip countdown (prototype experiment; plan default: stop) */
    keepRekeying?: boolean;
    /** a failed re-key only grips once you've been engaged this long (prototype experiment) */
    rekeyGraceS?: number;
  };
}

export type IceClass = 'white' | 'gray' | 'black';

export interface IcePreset {
  id: string;
  label: string;
  cls: IceClass;
  layer: IceLayerDef;
}

/** Plan §12.3, Normal difficulty. */
export const ICE_PRESETS: readonly IcePreset[] = [
  {
    id: 'white-1',
    label: 'WHITE-1',
    cls: 'white',
    layer: { ratios: [[1, 1], [1, 2]], tolRatio: 0.1, phaseDrift: 0.1, telegraph: 1.2, lockTime: 2.0, traceRate: 0.6, feedbackDps: 0 },
  },
  {
    id: 'gray-2',
    label: 'GRAY-2',
    cls: 'gray',
    layer: { ratios: [[1, 2], [2, 3], [3, 4]], tolRatio: 0.07, phaseDrift: 0.25, rekeyEvery: [7, 10], telegraph: 1.2, lockTime: 2.5, traceRate: 1.0, feedbackDps: 3 },
  },
  {
    id: 'gray-3',
    label: 'GRAY-3',
    cls: 'gray',
    layer: { ratios: [[2, 3], [3, 4], [3, 5], [4, 5]], tolRatio: 0.06, phaseDrift: 0.35, rekeyEvery: [6, 8], telegraph: 1.0, lockTime: 2.5, traceRate: 1.2, feedbackDps: 4 },
  },
  {
    id: 'black-1',
    label: 'BLACK-1',
    cls: 'black',
    layer: {
      ratios: [[2, 3], [3, 5], [4, 5], [5, 6]],
      tolRatio: 0.05,
      phaseDrift: 0.5,
      rekeyEvery: [4, 6],
      telegraph: 0.8,
      lockTime: 3.0,
      traceRate: 1.5,
      feedbackDps: 9,
      grip: { neuralThreshold: 60, seconds: 8 },
    },
  },
];

export type DifficultyId = 'story' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  tolRatio: number;
  rekeyInterval: number;
  telegraph: number;
  feedbackDps: number;
  /** Not in the plan's table; 1 for the three plan presets. Used by the tuning experiments. */
  lockTime?: number;
  phaseDrift?: number;
}

/** Plan §12.3 difficulty multipliers (gate windows don't apply to a breach). */
export const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'story', label: 'STORY', tolRatio: 1.6, rekeyInterval: 1.5, telegraph: 1.5, feedbackDps: 0.4 },
  { id: 'normal', label: 'NORMAL', tolRatio: 1.0, rekeyInterval: 1.0, telegraph: 1.0, feedbackDps: 1.0 },
  { id: 'hard', label: 'HARD', tolRatio: 0.8, rekeyInterval: 0.75, telegraph: 0.8, feedbackDps: 1.3 },
];

export type TuningId = 'plan' | 'proposed';

/**
 * Proposed tuning from the M4.1 playtest (see PLAYTEST.md): longer gray locks and earlier
 * re-keys so gray ICE actually re-keys mid-lock, a grip that can't fire on the first re-key,
 * and difficulty that scales lock time and drift (the real skill axes) instead of tolRatio.
 */
const PROPOSED_LAYER: Record<string, Partial<IceLayerDef>> = {
  'gray-2': { lockTime: 3.5, rekeyEvery: [5, 7] },
  'gray-3': { lockTime: 3.5, rekeyEvery: [4.5, 6.5] },
  'black-1': { grip: { neuralThreshold: 60, seconds: 8, rekeyGraceS: 7 } },
};

const PROPOSED_DIFF: Record<DifficultyId, Partial<Difficulty>> = {
  story: { lockTime: 0.85, phaseDrift: 0.7 },
  normal: {},
  hard: { phaseDrift: 1.2 },
};

export function getIce(id: string, tuning: TuningId = 'plan'): IcePreset {
  const base = ICE_PRESETS.find((p) => p.id === id) ?? ICE_PRESETS[2];
  if (tuning === 'plan') return base;
  return { ...base, layer: { ...base.layer, ...PROPOSED_LAYER[base.id] } };
}

export function getDifficulty(id: string, tuning: TuningId = 'plan'): Difficulty {
  const base = DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
  return tuning === 'plan' ? base : { ...base, ...PROPOSED_DIFF[base.id] };
}

export function applyDifficulty(layer: IceLayerDef, d: Difficulty): IceLayerDef {
  return {
    ...layer,
    tolRatio: layer.tolRatio * d.tolRatio,
    rekeyEvery: layer.rekeyEvery && [layer.rekeyEvery[0] * d.rekeyInterval, layer.rekeyEvery[1] * d.rekeyInterval],
    telegraph: layer.telegraph * d.telegraph,
    feedbackDps: layer.feedbackDps * d.feedbackDps,
    lockTime: layer.lockTime * (d.lockTime ?? 1),
    phaseDrift: layer.phaseDrift * (d.phaseDrift ?? 1),
  };
}
