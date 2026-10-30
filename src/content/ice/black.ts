import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import { ICE_LAYER_PRESETS } from './presets';

/** Subtractive black ICE with grip (plan §3.5, §5.5). */
export const BLACK_ICE: IceDef = {
  id: 'black-turing',
  class: 'black',
  shell: 'icosa',
  radius: 12,
  layers: [structuredClone(ICE_LAYER_PRESETS['black-1'])],
  hue: Beam.MIL,
};
