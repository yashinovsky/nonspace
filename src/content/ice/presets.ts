import type { IceLayerDef } from '../../breach/IceModel';

/** Starting layer tunings, Normal difficulty (plan §12.3). */
export const ICE_LAYER_PRESETS = {
  'white-1': {
    ratios: [
      [1, 1],
      [1, 2],
    ],
    tolRatio: 0.1,
    phaseDrift: 0.1,
    telegraph: 0,
    lockTime: 2.0,
    traceRate: 0.6,
    feedbackDps: 0,
  },
  'gray-2': {
    ratios: [
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    tolRatio: 0.07,
    phaseDrift: 0.25,
    rekeyEvery: [7, 10],
    telegraph: 1.2,
    lockTime: 2.5,
    traceRate: 1.0,
    feedbackDps: 3,
  },
  'gray-3': {
    ratios: [
      [2, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ],
    tolRatio: 0.06,
    phaseDrift: 0.35,
    rekeyEvery: [6, 8],
    telegraph: 1.0,
    lockTime: 2.5,
    traceRate: 1.2,
    feedbackDps: 4,
  },
  'black-1': {
    ratios: [
      [2, 3],
      [3, 5],
      [4, 5],
      [5, 6],
    ],
    tolRatio: 0.05,
    phaseDrift: 0.5,
    rekeyEvery: [4, 6],
    telegraph: 0.8,
    lockTime: 3.0,
    traceRate: 1.5,
    feedbackDps: 9,
    grip: { neuralThreshold: 60, seconds: 8 },
  },
  'kuang-gate': {
    ratios: [
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    tolRatio: 0.12,
    phaseDrift: 0.2,
    telegraph: 0,
    lockTime: 1.2,
    traceRate: 0.8,
    feedbackDps: 2,
  },
} satisfies Record<string, IceLayerDef>;

export type IceLayerPresetId = keyof typeof ICE_LAYER_PRESETS;

/** Difficulty multipliers (plan §12.3). Story is Easy. */
export const DIFFICULTY = {
  story: { tolRatio: 1.6, rekeyInterval: 1.5, telegraph: 1.5, feedbackDps: 0.4, gateWindows: 1.5 },
  normal: { tolRatio: 1, rekeyInterval: 1, telegraph: 1, feedbackDps: 1, gateWindows: 1 },
  hard: { tolRatio: 0.8, rekeyInterval: 0.75, telegraph: 0.8, feedbackDps: 1.3, gateWindows: 0.75 },
} as const;

export type Difficulty = keyof typeof DIFFICULTY;
