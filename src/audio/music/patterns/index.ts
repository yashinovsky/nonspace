import type { MusicState } from '../../AudioEngine';
import { approachPattern } from './approach';
import { beachPattern } from './beach';
import { breachPattern } from './breach';
import { corePattern } from './core';
import { gripPattern } from './grip';
import { kuangDivePattern } from './kuangDive';
import { silentPattern } from './silent';
import { simstimPattern } from './simstim';
import { transitPattern } from './transit';
import type { MusicPattern } from './types';

export const PATTERNS: Record<MusicState, MusicPattern> = {
  silent: silentPattern,
  transit: transitPattern,
  approach: approachPattern,
  breach: breachPattern,
  grip: gripPattern,
  core: corePattern,
  simstim: simstimPattern,
  kuangDive: kuangDivePattern,
  beach: beachPattern,
};

export {
  approachPattern,
  beachPattern,
  breachPattern,
  corePattern,
  gripPattern,
  kuangDivePattern,
  silentPattern,
  simstimPattern,
  transitPattern,
};
export {
  LAYER_IDS,
  lerpGains,
  mixPatternGains,
  OPEN_FILTER_HZ,
  zeroGains,
  type LayerGains,
  type LayerId,
  type MusicPattern,
  type PatternLayer,
  type PatternStep,
} from './types';
