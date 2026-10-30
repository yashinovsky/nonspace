import type { Beam } from '../render/lines/BeamBatch';

/** ICE definitions (plan §9.3). The runtime IceModel (drift, re-key scheduler, grip) is M4.2's. */
export type IceClass = 'white' | 'gray' | 'black' | 'ta';

export interface IceLayerDef {
  /** Allowed a:b ratios. */
  ratios: Array<[number, number]>;
  /** Ratio tolerance in log units, e.g. 0.06. */
  tolRatio: number;
  /** rad/s */
  phaseDrift: number;
  /** Seconds, random in range; undefined = never re-keys. */
  rekeyEvery?: [number, number];
  /** Seconds of warning before a re-key. */
  telegraph: number;
  /** Seconds at m >= LOCK_THRESHOLD to crack. */
  lockTime: number;
  /** Trace %/s while engaged. */
  traceRate: number;
  /** Neural load/s while m < DISSONANCE_THRESHOLD. */
  feedbackDps: number;
  grip?: { neuralThreshold: number; seconds: number };
}

export interface IceDef {
  id: string;
  class: IceClass;
  shell: 'cube' | 'octa' | 'icosa' | 'slab';
  radius: number;
  layers: IceLayerDef[];
  hue: Beam;
}
