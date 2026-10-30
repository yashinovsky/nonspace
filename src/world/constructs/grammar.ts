/**
 * Parametric construct grammar (plan §8.6 / M2.1). Outputs LineSet, face
 * triangles and PointSet. Heraldry and landmarks are M2.2.
 */

import { pcg32, type Pcg32 } from '../../core/rng';
import type { Beam } from '../../render/lines/BeamBatch';
import { generateLod, type LodLevel, NEAR_SEGMENT_BUDGET } from './lod';
import {
  isPrimitiveKind,
  type ConstructGeometry,
  type Distribution,
  type PrimitiveKind,
  type PrimitiveSpec,
  type SolidKind,
} from './primitives';

export type {
  Aabb,
  AxisId,
  BoxParams,
  ConstellationParams,
  ConstructGeometry,
  ConstructStats,
  CubeStackParams,
  Distribution,
  EmitOptions,
  FaceSet,
  GeodesicParams,
  MastParams,
  NestedPolyParams,
  PrimitiveKind,
  PrimitiveSpec,
  SlabTerraceParams,
  SolidKind,
  SpiralArmsParams,
  TowerParams,
  ZigguratParams,
} from './primitives';
export {
  aabbCentroid,
  aabbExtent,
  boundsOf,
  Builder,
  emptyFaceSet,
  emitAabb,
  emitPrimitive,
  isPrimitiveKind,
  padAabb,
  PRIMITIVE_BEAM,
  PRIMITIVE_KINDS,
  SOLID_KINDS,
  DISTRIBUTIONS,
} from './primitives';
export {
  createLodFade,
  DEFAULT_LOD_DISTANCES,
  FAR_POINT_BUDGET,
  generateFar,
  generateLod,
  generateMid,
  generateNear,
  isLodLevel,
  LOD_CROSSFADE_S,
  LOD_HYSTERESIS,
  LOD_LEVELS,
  MID_SEGMENT_BUDGET,
  NEAR_SEGMENT_BUDGET,
  selectLod,
  tickLodFade,
  type LodDistances,
  type LodFade,
  type LodLevel,
} from './lod';

export interface GenerateOptions {
  lod?: LodLevel;
  seed?: number;
  color?: Beam;
  intensity?: number;
  importance?: number;
  rng?: Pcg32;
}

export function defaultSpec(kind: PrimitiveKind): PrimitiveSpec {
  switch (kind) {
    case 'box':
      return { kind, w: 8, h: 8, d: 8, subdivisions: 2, hatch: true };
    case 'slabTerrace':
      return { kind, count: 5, spacing: 2, w: 24, h: 2, d: 8, symmetry: true };
    case 'cubeStack':
      return { kind, n: 4, m: 4, k: 5, gap: 0.35 };
    case 'ziggurat':
      return { kind, steps: 7, base: 28, stepH: 3, inset: 1.8 };
    case 'mast':
      return { kind, height: 32, sections: 6, dishes: 3 };
    case 'nestedPoly':
      return { kind, solid: 'octa', shells: 3, rotationAxes: [0, 1, 2], radius: 8, hatch: true };
    case 'geodesic':
      return { kind, frequency: 2, radius: 10 };
    case 'tower':
      return { kind, sides: 6, height: 24, taper: 0.45, rings: 5 };
    case 'constellation':
      return { kind, n: 48, distribution: 'cluster' };
    case 'spiralArms':
      return { kind, arms: 3, points: 120, pitch: 0.22 };
  }
}

export function sampleSpec(kind: PrimitiveKind, rng: Pcg32): PrimitiveSpec {
  switch (kind) {
    case 'box':
      return {
        kind,
        w: rng.float(4, 16),
        h: rng.float(4, 24),
        d: rng.float(4, 16),
        subdivisions: rng.int(0, 3),
        hatch: rng.chance(0.55),
      };
    case 'slabTerrace':
      return {
        kind,
        count: rng.int(3, 8),
        spacing: rng.float(0.5, 4),
        w: rng.float(12, 36),
        h: rng.float(1, 3),
        d: rng.float(4, 14),
        symmetry: rng.chance(0.7),
      };
    case 'cubeStack':
      return {
        kind,
        n: rng.int(2, 6),
        m: rng.int(2, 6),
        k: rng.int(2, 7),
        gap: rng.float(0, 0.5),
        blinkMask: rng.chance(0.4),
      };
    case 'ziggurat':
      return {
        kind,
        steps: rng.int(4, 9),
        base: rng.float(16, 40),
        stepH: rng.float(2, 5),
        inset: rng.float(1, 2.4),
      };
    case 'mast':
      return {
        kind,
        height: rng.float(18, 48),
        sections: rng.int(4, 8),
        dishes: rng.int(1, 4),
      };
    case 'nestedPoly': {
      const solids: SolidKind[] = ['tetra', 'octa', 'icosa'];
      return {
        kind,
        solid: rng.pick(solids),
        shells: rng.int(2, 5),
        rotationAxes: [0, 1, 2],
        radius: rng.float(5, 14),
        hatch: rng.chance(0.5),
      };
    }
    case 'geodesic':
      return { kind, frequency: rng.int(1, 3), radius: rng.float(6, 16) };
    case 'tower':
      return {
        kind,
        sides: rng.int(4, 8),
        height: rng.float(14, 40),
        taper: rng.float(0.15, 0.7),
        rings: rng.int(3, 8),
      };
    case 'constellation': {
      const dists: Distribution[] = ['uniform-sphere', 'gaussian', 'grid', 'cluster'];
      return { kind, n: rng.int(16, 80), distribution: rng.pick(dists) };
    }
    case 'spiralArms':
      return {
        kind,
        arms: rng.int(2, 5),
        points: rng.int(40, 160),
        pitch: rng.float(0.12, 0.4),
      };
  }
}

export function parsePrimitiveKind(raw: string | null | undefined): PrimitiveKind | null {
  if (!raw) return null;
  const k = raw.trim();
  return isPrimitiveKind(k) ? k : null;
}

export function generate(spec: PrimitiveSpec, opts: GenerateOptions = {}): ConstructGeometry {
  const lod: LodLevel = opts.lod ?? 'near';
  const rng = opts.rng ?? pcg32(opts.seed ?? 1);
  return generateLod(spec, lod, {
    color: opts.color,
    intensity: opts.intensity,
    importance: opts.importance,
    seed: opts.seed,
    rng,
  });
}

export function generateDefault(
  kind: PrimitiveKind,
  opts: GenerateOptions = {},
): ConstructGeometry {
  return generate(defaultSpec(kind), opts);
}

/** Segment budget for the requested LOD (0 = no lines). */
export function segmentBudget(kind: PrimitiveKind, lod: LodLevel): { min: number; max: number } {
  if (lod === 'far') return { min: 0, max: 0 };
  if (lod === 'mid') return { min: 12, max: 24 };
  const n = NEAR_SEGMENT_BUDGET[kind];
  return { min: 0, max: n };
}
