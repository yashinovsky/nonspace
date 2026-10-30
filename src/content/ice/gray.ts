import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import { ICE_LAYER_PRESETS } from './presets';

/** Hosaka-style gray ICE: denser hatch, nested counter-rotating shells, re-keys. */
export const GRAY_ICE: IceDef = {
  id: 'gray-hosaka',
  class: 'gray',
  shell: 'octa',
  radius: 12,
  layers: [
    structuredClone(ICE_LAYER_PRESETS['gray-2']),
    structuredClone(ICE_LAYER_PRESETS['gray-3']),
  ],
  hue: Beam.ICE,
};
