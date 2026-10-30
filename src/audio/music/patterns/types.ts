import type { MusicState } from '../../AudioEngine';

export const LAYER_IDS = [
  'pad',
  'arp',
  'bass',
  'hats',
  'kick',
  'snare',
  'drone',
  'growl',
  'heartbeat',
  'choir',
  'surf',
  'wind',
  'dubBass',
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export type LayerGains = Record<LayerId, number>;

export interface PatternStep {
  /** 0..15 inside the bar (16th grid). */
  step: number;
  /** Scale degree from the mission root. Unpitched layers ignore this. */
  degree?: number;
  octave?: number;
  probability: number;
  vel: number;
  open?: boolean;
}

export interface PatternLayer {
  id: LayerId;
  gain: number;
  steps: readonly PatternStep[];
}

export interface MusicPattern {
  state: MusicState;
  /** Applied on setState when present (kuangDive → 128). */
  bpm?: number;
  /** Music-bus lowpass; omitted means fully open. */
  filterHz?: number;
  /** Sidechain duck in dB while this state is active (grip → −24). */
  duckDb?: number;
  layers: readonly PatternLayer[];
}

export function zeroGains(): LayerGains {
  return {
    pad: 0,
    arp: 0,
    bass: 0,
    hats: 0,
    kick: 0,
    snare: 0,
    drone: 0,
    growl: 0,
    heartbeat: 0,
    choir: 0,
    surf: 0,
    wind: 0,
    dubBass: 0,
  };
}

export function mixPatternGains(pattern: MusicPattern): LayerGains {
  const g = zeroGains();
  for (let i = 0; i < pattern.layers.length; i++) {
    const layer = pattern.layers[i]!;
    g[layer.id] = layer.gain;
  }
  return g;
}

export function lerpGains(a: LayerGains, b: LayerGains, x: number): LayerGains {
  const g = zeroGains();
  for (let i = 0; i < LAYER_IDS.length; i++) {
    const id = LAYER_IDS[i]!;
    g[id] = a[id] * (1 - x) + b[id] * x;
  }
  return g;
}

export const OPEN_FILTER_HZ = 18000;
