/**
 * Corporate heraldry (plan §5.4, §7.2, M2.2). Landmarks in `landmarks.ts`
 * pick a corp and may override spec / rhythm. `pulse(t, tempo)` is the
 * renderer hook onto M5.3's tempo grid; `corpPulse` is the per-corp rhythm.
 */

import {
  beatsAt,
  createTempoClock,
  DEFAULT_BPM,
  pulse as tempoPulse,
  type TempoClock,
} from '../audio/music/Sequencer';
import { hash2i, hashString } from '../core/hash';
import { pcg32 } from '../core/rng';
import { Beam } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { PrimitiveSpec } from '../world/constructs/primitives';

export const CORP_IDS = [
  'tessierAshpool',
  'mitsubishi',
  'esfa',
  'senseNet',
  'hosaka',
  'turing',
  'military',
  'minor',
] as const;

export type CorpId = (typeof CORP_IDS)[number];

export const RHYTHM_KINDS = [
  'breathe',
  'ledger',
  'reactor',
  'broadcast',
  'ticks',
  'radar',
  'listen',
  'drift',
  'tempo',
] as const;
export type RhythmKind = (typeof RHYTHM_KINDS)[number];

export interface CorpHeraldry {
  name: string;
  /** Beam indices; first is the body hue. Extra entries are inner/heart hues. */
  hues: readonly Beam[];
  rhythm: RhythmKind;
  /** Default authored spec for this corp's look (`kind` is the §8.6 grammar). */
  spec: PrimitiveSpec;
}

export const CORPS: Record<CorpId, CorpHeraldry> = {
  tessierAshpool: {
    name: 'Tessier-Ashpool S.A.',
    hues: [Beam.TA],
    rhythm: 'breathe',
    spec: { kind: 'slabTerrace', count: 6, spacing: 1.6, w: 28, h: 2, d: 9, symmetry: true },
  },
  mitsubishi: {
    name: 'Mitsubishi Bank of America',
    hues: [Beam.MITSU],
    rhythm: 'ledger',
    spec: { kind: 'cubeStack', n: 5, m: 6, k: 5, gap: 0.28, blinkMask: true },
  },
  esfa: {
    name: 'Eastern Seaboard Fission Authority',
    hues: [Beam.ESFA],
    rhythm: 'reactor',
    spec: { kind: 'ziggurat', steps: 7, base: 36, stepH: 3.2, inset: 2 },
  },
  senseNet: {
    name: 'Sense/Net',
    hues: [Beam.AMBER],
    rhythm: 'broadcast',
    spec: { kind: 'mast', height: 42, sections: 7, dishes: 4 },
  },
  hosaka: {
    name: 'Hosaka',
    hues: [Beam.GRID, Beam.ICE],
    rhythm: 'ticks',
    spec: {
      kind: 'nestedPoly',
      solid: 'octa',
      shells: 4,
      rotationAxes: [0, 1, 2],
      radius: 9,
      hatch: true,
    },
  },
  turing: {
    name: 'Turing Registry',
    hues: [Beam.MIL],
    rhythm: 'radar',
    spec: { kind: 'geodesic', frequency: 3, radius: 12 },
  },
  military: {
    name: 'Military systems',
    hues: [Beam.MIL],
    rhythm: 'drift',
    spec: { kind: 'spiralArms', arms: 3, points: 160, pitch: 0.22 },
  },
  minor: {
    name: 'Minor node',
    hues: [Beam.GRID],
    rhythm: 'tempo',
    spec: { kind: 'tower', sides: 4, height: 16, taper: 0.28, rings: 4 },
  },
};

export function isCorpId(v: string): v is CorpId {
  return (CORP_IDS as readonly string[]).includes(v);
}

export function asTempoClock(tempo: number | TempoClock = DEFAULT_BPM): TempoClock {
  return typeof tempo === 'number' ? createTempoClock(tempo, 0) : tempo;
}

/**
 * Rhythm animation hook (plan M2.2 / M5.3). Raised-cosine envelope in [0, 1],
 * peaking at 1 on each quarter-note beat of `tempo` (default 96 BPM, origin 0).
 * Pass a live `TempoClock` so constructs stay on the sequencer grid (±10 ms).
 */
export function pulse(t: number, tempo: number | TempoClock = DEFAULT_BPM): number {
  return tempoPulse(t, tempo);
}

export interface CorpPulse {
  intensity: number;
  /** 0..1 of the corp's primary cycle. */
  phase: number;
  yaw: number;
  pitch: number;
  /** Sense/Net broadcast ring, 0 = hidden, 1 = full radius. */
  ring: number;
  /** ESFA apex jitter (world units). */
  jitter: number;
  /** Berne over-white heart intensity. */
  heart: number;
  /** Current eighth-note index (ledger / ticks). */
  eighth: number;
}

const TWO_PI = Math.PI * 2;

function fract(v: number): number {
  return v - Math.floor(v);
}

/**
 * Per-corp rhythm state at time `t`, locked to `tempo` where the table says
 * so (ledger eighths, 4/4 ticks, 2-bar Sense/Net ring) and to absolute Hz
 * where the book/plan names a frequency (T-A 0.1 Hz, ESFA 1 Hz, Turing 0.25 Hz).
 */
export function corpPulse(
  corp: CorpId,
  t: number,
  tempo: number | TempoClock = DEFAULT_BPM,
  rhythm: RhythmKind = CORPS[corp].rhythm,
): CorpPulse {
  const clock = asTempoClock(tempo);
  const beats = beatsAt(t, clock);
  const qPulse = pulse(t, clock);
  const eighth = Math.floor(beats * 2 + 1e-9);
  const out: CorpPulse = {
    intensity: 1,
    phase: fract(beats),
    yaw: 0,
    pitch: 0,
    ring: 0,
    jitter: 0,
    heart: 0,
    eighth,
  };

  switch (rhythm) {
    case 'breathe': {
      const phase = fract(t * 0.1);
      out.phase = phase;
      out.intensity = 1 + 0.15 * Math.sin(phase * TWO_PI);
      break;
    }
    case 'ledger': {
      out.phase = fract(beats * 2);
      out.intensity = 0.82 + 0.18 * pulse(t, clock);
      break;
    }
    case 'reactor': {
      const phase = fract(t * 1);
      out.phase = phase;
      out.intensity = 1 + 0.22 * Math.sin(phase * TWO_PI);
      out.jitter = 0.12 * Math.sin(t * TWO_PI * 7);
      break;
    }
    case 'broadcast': {
      const bars = beats / clock.beatsPerBar;
      const twoBar = fract(bars / 2);
      out.phase = twoBar;
      out.yaw = t * 0.55;
      out.ring = twoBar;
      out.intensity = 0.9 + 0.12 * qPulse;
      break;
    }
    case 'ticks': {
      out.phase = fract(beats);
      out.intensity = 0.78 + 0.22 * qPulse;
      out.yaw = beats * (Math.PI / 8);
      out.pitch = beats * 0.17;
      break;
    }
    case 'radar': {
      const phase = fract(t * 0.25);
      out.phase = phase;
      out.yaw = phase * TWO_PI;
      out.intensity = 0.88 + 0.12 * qPulse;
      break;
    }
    case 'listen': {
      const bar = Math.floor(beats / clock.beatsPerBar);
      const rng = pcg32(hash2i(bar, 17, hashString('listen')));
      const gate = rng.float(0.35, 1);
      out.phase = fract(beats / clock.beatsPerBar);
      out.intensity = 0.65 + 0.35 * gate * (0.5 + 0.5 * qPulse);
      out.heart = 1.6 + 2.2 * rng.float(0, 1);
      break;
    }
    case 'drift': {
      out.phase = fract(t * 0.01);
      out.yaw = t * 0.02;
      out.intensity = 0.95;
      break;
    }
    case 'tempo': {
      const seed = hashString(corp);
      const subdiv = seed % 3; // 0 quarter, 1 eighth, 2 half
      const rate = subdiv === 1 ? 2 : subdiv === 2 ? 0.5 : 1;
      const phase = fract(beats * rate);
      out.phase = phase;
      out.intensity = 0.8 + 0.2 * (0.5 + 0.5 * Math.cos(phase * TWO_PI));
      break;
    }
  }
  return out;
}

/**
 * Mitsubishi ledger blink: a fresh deterministic mask each eighth note.
 * 1 = cube on, 0 = cube dark. Most cubes stay on so the stack still reads.
 */
export function ledgerBlinkMask(
  n: number,
  m: number,
  k: number,
  t: number,
  tempo: number | TempoClock = DEFAULT_BPM,
  seed = 1,
): Uint8Array {
  const clock = asTempoClock(tempo);
  const eighth = Math.floor(beatsAt(t, clock) * 2 + 1e-9);
  const total = Math.max(1, n | 0) * Math.max(1, m | 0) * Math.max(1, k | 0);
  const mask = new Uint8Array(total);
  const rng = pcg32(hash2i(eighth, seed, hashString('ledger')));
  for (let i = 0; i < total; i++) mask[i] = rng.chance(0.72) ? 1 : 0;
  if (mask.every((v) => v === 0)) mask[0] = 1;
  return mask;
}

/** Rec.709 luma of a beam palette entry, for grayscale checks. */
export function beamLuma(beam: Beam): number {
  const hex = BEAM_HEX[beam] ?? 0;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
