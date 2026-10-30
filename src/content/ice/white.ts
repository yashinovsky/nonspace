import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import { ICE_LAYER_PRESETS } from './presets';

/** Tutorial / clinic white ICE (plan §3.5, §4.4 M1). Sparse hatch, no re-key. */
export const WHITE_ICE: IceDef = {
  id: 'white-clinic',
  class: 'white',
  shell: 'cube',
  radius: 12,
  layers: [structuredClone(ICE_LAYER_PRESETS['white-1'])],
  hue: Beam.ICE,
};
