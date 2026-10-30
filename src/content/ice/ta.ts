import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import { ICE_LAYER_PRESETS } from './presets';

/** Tessier-Ashpool emerald ICE. Only Kuang can breach it (plan §3.5 / §4.4 M5). */
export const TA_ICE: IceDef = {
  id: 'ta-straylight',
  class: 'ta',
  shell: 'slab',
  radius: 18,
  layers: [structuredClone(ICE_LAYER_PRESETS['kuang-gate'])],
  hue: Beam.TA,
};
