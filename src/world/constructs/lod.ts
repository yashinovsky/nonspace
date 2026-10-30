/**
 * Construct LOD (plan §8.6): far = 1 lightpoint, mid = 12–24 outline edges,
 * near = full primitive. Hysteresis plus a 0.3 s intensity crossfade.
 */

import { vec3 } from '../../core/math/vec3';
import { BeamFlag, createLineSet } from '../../render/lines/BeamBatch';
import { createPointSet, DEFAULT_POINT_SIZE } from '../../render/points/PointBatch';
import {
  aabbCentroid,
  aabbExtent,
  boundsOf,
  Builder,
  emitAabb,
  emptyFaceSet,
  emitPrimitive,
  padAabb,
  PRIMITIVE_BEAM,
  type ConstructGeometry,
  type EmitOptions,
  type PrimitiveKind,
  type PrimitiveSpec,
} from './primitives';

export const LOD_LEVELS = ['far', 'mid', 'near'] as const;
export type LodLevel = (typeof LOD_LEVELS)[number];

export const LOD_CROSSFADE_S = 0.3;
/** Distance band as a fraction of the threshold. Stay on the current LOD inside it. */
export const LOD_HYSTERESIS = 0.2;

/** Near/mid switch distances in world units (lattice radius / corporate tier). */
export const DEFAULT_LOD_DISTANCES = {
  /** d < near → near */
  near: 200,
  /** near ≤ d < mid → mid; d ≥ mid → far */
  mid: 2000,
} as const;

export type LodDistances = { near: number; mid: number };

/**
 * Near-LOD unique-edge budgets (plan M2.1 AC). Mid is always 12–24; far is
 * 0 segments + 1 point. Generation clamps to these.
 */
export const NEAR_SEGMENT_BUDGET: Record<PrimitiveKind, number> = {
  box: 256,
  slabTerrace: 512,
  cubeStack: 2048,
  ziggurat: 512,
  mast: 256,
  nestedPoly: 1024,
  geodesic: 2048,
  tower: 512,
  constellation: 0,
  spiralArms: 0,
};

export const MID_SEGMENT_BUDGET = { min: 12, max: 24 } as const;
export const FAR_POINT_BUDGET = 1;

export function isLodLevel(v: string): v is LodLevel {
  return (LOD_LEVELS as readonly string[]).includes(v);
}

export function selectLod(
  distance: number,
  previous: LodLevel,
  distances: LodDistances = DEFAULT_LOD_DISTANCES,
  hysteresis = LOD_HYSTERESIS,
): LodLevel {
  const h = Math.max(0, hysteresis);
  const near = distances.near;
  const mid = distances.mid;
  const d = Math.max(0, distance);
  if (previous === 'near') {
    if (d > near * (1 + h)) return d >= mid * (1 + h) ? 'far' : 'mid';
    return 'near';
  }
  if (previous === 'mid') {
    if (d < near * (1 - h)) return 'near';
    if (d > mid * (1 + h)) return 'far';
    return 'mid';
  }
  if (d < near * (1 - h)) return 'near';
  if (d < mid * (1 - h)) return 'mid';
  return 'far';
}

export interface LodFade {
  current: LodLevel;
  from: LodLevel;
  to: LodLevel;
  /** 0 = `from` only, 1 = `to` only. */
  mix: number;
}

export function createLodFade(level: LodLevel = 'near'): LodFade {
  return { current: level, from: level, to: level, mix: 1 };
}

export function tickLodFade(
  fade: LodFade,
  distance: number,
  dt: number,
  distances: LodDistances = DEFAULT_LOD_DISTANCES,
): LodFade {
  const next = selectLod(distance, fade.current, distances);
  let { from, to, mix, current } = fade;
  if (next !== current) {
    from = mix >= 1 ? current : from;
    to = next;
    current = next;
    mix = 0;
  }
  mix = Math.min(1, mix + Math.max(0, dt) / LOD_CROSSFADE_S);
  return { current, from, to, mix };
}

function farSize(bounds: ConstructGeometry['bounds'], importance?: number): number {
  const ex = aabbExtent(bounds);
  const imp = importance ?? Math.log2(1 + ex);
  return DEFAULT_POINT_SIZE * (1 + Math.min(8, Math.max(0, imp)) * 0.35);
}

export function generateFar(
  spec: PrimitiveSpec,
  opts: EmitOptions & { importance?: number } = {},
): ConstructGeometry {
  const bounds = padAabb(boundsOf(spec));
  const c = aabbCentroid(bounds);
  const color = opts.color ?? PRIMITIVE_BEAM[spec.kind];
  const intensity = opts.intensity ?? 1.2;
  const points = createPointSet(FAR_POINT_BUDGET, { size: true });
  points.positions[0] = c.x;
  points.positions[1] = c.y;
  points.positions[2] = c.z;
  points.color[0] = color;
  points.intensity[0] = intensity;
  points.size![0] = farSize(bounds, opts.importance);
  return {
    lines: createLineSet(0, { flags: true }),
    faces: emptyFaceSet(),
    points,
    bounds,
    stats: { segments: 0, triangles: 0, points: FAR_POINT_BUDGET },
  };
}

export function generateMid(spec: PrimitiveSpec, opts: EmitOptions = {}): ConstructGeometry {
  const bounds = padAabb(boundsOf(spec));
  const b = new Builder();
  const color = opts.color ?? PRIMITIVE_BEAM[spec.kind];
  const intensity = opts.intensity ?? 1;
  emitAabb(b, bounds.min, bounds.max, color, intensity, opts.flags ?? 0, true);
  // Optional character: a mid-height ring, still within 12–24 edges.
  const extra =
    spec.kind === 'ziggurat' ||
    spec.kind === 'tower' ||
    spec.kind === 'mast' ||
    spec.kind === 'geodesic';
  if (extra) {
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const x0 = bounds.min.x * 0.6 + bounds.max.x * 0.4;
    const x1 = bounds.min.x * 0.4 + bounds.max.x * 0.6;
    const z0 = bounds.min.z * 0.6 + bounds.max.z * 0.4;
    const z1 = bounds.min.z * 0.4 + bounds.max.z * 0.6;
    const r = [b.vertex(x0, y, z0), b.vertex(x1, y, z0), b.vertex(x1, y, z1), b.vertex(x0, y, z1)];
    b.edge(r[0]!, r[1]!, color, intensity * 0.7, 0);
    b.edge(r[1]!, r[2]!, color, intensity * 0.7, 0);
    b.edge(r[2]!, r[3]!, color, intensity * 0.7, 0);
    b.edge(r[3]!, r[0]!, color, intensity * 0.7, 0);
  }
  const geom = b.freeze();
  if (geom.stats.segments > MID_SEGMENT_BUDGET.max) {
    const clipped = new Builder();
    emitAabb(clipped, bounds.min, bounds.max, color, intensity, 0, true);
    return clipped.freeze();
  }
  return geom;
}

export function generateNear(spec: PrimitiveSpec, opts: EmitOptions = {}): ConstructGeometry {
  const budget = NEAR_SEGMENT_BUDGET[spec.kind];
  return emitPrimitive(spec, {
    ...opts,
    flags: opts.flags ?? BeamFlag.DWELL,
    maxSegments: budget > 0 ? budget : opts.maxSegments,
  });
}

export function generateLod(
  spec: PrimitiveSpec,
  lod: LodLevel,
  opts: EmitOptions & { importance?: number } = {},
): ConstructGeometry {
  if (lod === 'far') return generateFar(spec, opts);
  if (lod === 'mid') return generateMid(spec, opts);
  return generateNear(spec, opts);
}

/** Empty geometry helper for tests / fade from-nothing. */
export function emptyGeometry(): ConstructGeometry {
  return {
    lines: createLineSet(0, { flags: true }),
    faces: emptyFaceSet(),
    points: createPointSet(0, { size: true }),
    bounds: { min: vec3(-0.5, -0.5, -0.5), max: vec3(0.5, 0.5, 0.5) },
    stats: { segments: 0, triangles: 0, points: 0 },
  };
}
