/**
 * Construct primitives (plan §8.6). Pure geometry: no Three, no DOM, no
 * Math.random. Consumers get LineSet + FaceSet + PointSet via `emitPrimitive`.
 */

import { vec3, type Vec3 } from '../../core/math/vec3';
import type { Pcg32 } from '../../core/rng';
import {
  Beam,
  BeamFlag,
  createLineSet,
  DEFAULT_BEAM_INTENSITY,
  type LineSet,
} from '../../render/lines/BeamBatch';
import { createPointSet, DEFAULT_POINT_SIZE, type PointSet } from '../../render/points/PointBatch';

export const PRIMITIVE_KINDS = [
  'box',
  'slabTerrace',
  'cubeStack',
  'ziggurat',
  'mast',
  'nestedPoly',
  'geodesic',
  'tower',
  'constellation',
  'spiralArms',
] as const;
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

export const SOLID_KINDS = ['tetra', 'octa', 'icosa'] as const;
export type SolidKind = (typeof SOLID_KINDS)[number];

export const DISTRIBUTIONS = ['uniform-sphere', 'gaussian', 'grid', 'cluster'] as const;
export type Distribution = (typeof DISTRIBUTIONS)[number];

export type AxisId = 0 | 1 | 2;

export interface BoxParams {
  kind: 'box';
  w: number;
  h: number;
  d: number;
  subdivisions: number;
  hatch: boolean;
}
export interface SlabTerraceParams {
  kind: 'slabTerrace';
  count: number;
  spacing: number;
  w: number;
  h: number;
  d: number;
  symmetry: boolean;
}
export interface CubeStackParams {
  kind: 'cubeStack';
  n: number;
  m: number;
  k: number;
  gap: number;
  blinkMask?: Uint8Array | boolean;
}
export interface ZigguratParams {
  kind: 'ziggurat';
  steps: number;
  base: number;
  stepH: number;
  inset: number;
}
export interface MastParams {
  kind: 'mast';
  height: number;
  sections: number;
  dishes: number;
}
export interface NestedPolyParams {
  kind: 'nestedPoly';
  solid: SolidKind;
  shells: number;
  rotationAxes: readonly AxisId[];
  radius?: number;
  hatch?: boolean;
}
export interface GeodesicParams {
  kind: 'geodesic';
  frequency: number;
  radius: number;
}
export interface TowerParams {
  kind: 'tower';
  sides: number;
  height: number;
  taper: number;
  rings: number;
}
export interface ConstellationParams {
  kind: 'constellation';
  n: number;
  distribution: Distribution;
}
export interface SpiralArmsParams {
  kind: 'spiralArms';
  arms: number;
  points: number;
  pitch: number;
}

export type PrimitiveSpec =
  | BoxParams
  | SlabTerraceParams
  | CubeStackParams
  | ZigguratParams
  | MastParams
  | NestedPolyParams
  | GeodesicParams
  | TowerParams
  | ConstellationParams
  | SpiralArmsParams;

/** Triangle soup for the construct depth prepass (plan §8.6). */
export interface FaceSet {
  /** [x, y, z] * vertexCount */
  positions: Float32Array;
  /** 3 * triangleCount */
  indices: Uint32Array;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface ConstructStats {
  segments: number;
  triangles: number;
  points: number;
}

export interface ConstructGeometry {
  lines: LineSet;
  faces: FaceSet;
  points: PointSet;
  bounds: Aabb;
  stats: ConstructStats;
  /** cubeStack only: n*m*k bytes, 0 = off / 1 = on. */
  blinkMask?: Uint8Array;
}

export interface EmitOptions {
  color?: Beam;
  intensity?: number;
  flags?: number;
  seed?: number;
  rng?: Pcg32;
  /** Hard cap on unique edges. Extra edges are dropped (first wins). */
  maxSegments?: number;
}

export const PRIMITIVE_BEAM: Record<PrimitiveKind, Beam> = {
  box: Beam.GRID,
  slabTerrace: Beam.TA,
  cubeStack: Beam.MITSU,
  ziggurat: Beam.ESFA,
  mast: Beam.AMBER,
  nestedPoly: Beam.ICE,
  geodesic: Beam.MIL,
  tower: Beam.GRID,
  constellation: Beam.AFTERGLOW,
  spiralArms: Beam.MIL,
};

const PHI = (1 + Math.sqrt(5)) / 2;
const QUANT = 1e5;

export function isPrimitiveKind(v: string): v is PrimitiveKind {
  return (PRIMITIVE_KINDS as readonly string[]).includes(v);
}

export function emptyFaceSet(): FaceSet {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

export function padAabb(bounds: Aabb, pad = 0.5): Aabb {
  const { min, max } = bounds;
  const out: Aabb = {
    min: vec3(min.x, min.y, min.z),
    max: vec3(max.x, max.y, max.z),
  };
  if (!Number.isFinite(out.min.x) || !Number.isFinite(out.max.x)) {
    return { min: vec3(-pad, -pad, -pad), max: vec3(pad, pad, pad) };
  }
  if (out.max.x - out.min.x < 1e-6) {
    out.min.x -= pad;
    out.max.x += pad;
  }
  if (out.max.y - out.min.y < 1e-6) {
    out.min.y -= pad;
    out.max.y += pad;
  }
  if (out.max.z - out.min.z < 1e-6) {
    out.min.z -= pad;
    out.max.z += pad;
  }
  return out;
}

export function aabbCentroid(b: Aabb): Vec3 {
  return vec3((b.min.x + b.max.x) * 0.5, (b.min.y + b.max.y) * 0.5, (b.min.z + b.max.z) * 0.5);
}

export function aabbExtent(b: Aabb): number {
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
}

export function expandAabb(b: Aabb, x: number, y: number, z: number): void {
  if (x < b.min.x) b.min.x = x;
  if (y < b.min.y) b.min.y = y;
  if (z < b.min.z) b.min.z = z;
  if (x > b.max.x) b.max.x = x;
  if (y > b.max.y) b.max.y = y;
  if (z > b.max.z) b.max.z = z;
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function clampNum(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

interface EdgeRec {
  i: number;
  j: number;
  color: number;
  intensity: number;
  flags: number;
}

interface PointRec {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  size: number;
}

/** Unique-vertex / unique-undirected-edge accumulator. */
export class Builder {
  private readonly verts: number[] = [];
  private readonly vmap = new Map<string, number>();
  private readonly edges = new Map<string, EdgeRec>();
  private readonly tris: number[] = [];
  private readonly pts: PointRec[] = [];
  readonly bounds: Aabb = {
    min: vec3(Infinity, Infinity, Infinity),
    max: vec3(-Infinity, -Infinity, -Infinity),
  };
  blinkMask?: Uint8Array;
  maxSegments = Infinity;

  vertex(x: number, y: number, z: number): number {
    const qx = Math.round(x * QUANT) / QUANT;
    const qy = Math.round(y * QUANT) / QUANT;
    const qz = Math.round(z * QUANT) / QUANT;
    const key = `${qx},${qy},${qz}`;
    const existing = this.vmap.get(key);
    if (existing !== undefined) return existing;
    const i = this.verts.length / 3;
    this.verts.push(qx, qy, qz);
    this.vmap.set(key, i);
    expandAabb(this.bounds, qx, qy, qz);
    return i;
  }

  edge(a: number, b: number, color: number, intensity: number, flags: number): void {
    if (a === b) return;
    if (this.edges.size >= this.maxSegments) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo},${hi}`;
    if (this.edges.has(key)) return;
    this.edges.set(key, { i: lo, j: hi, color, intensity, flags });
  }

  tri(a: number, b: number, c: number): void {
    if (a === b || b === c || c === a) return;
    this.tris.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  point(
    x: number,
    y: number,
    z: number,
    color: number,
    intensity: number,
    size = DEFAULT_POINT_SIZE,
  ): void {
    expandAabb(this.bounds, x, y, z);
    this.pts.push({ x, y, z, color, intensity, size });
  }

  freeze(): ConstructGeometry {
    const n = this.edges.size;
    const lines = createLineSet(n, { flags: true });
    let s = 0;
    for (const e of this.edges.values()) {
      const ax = this.verts[e.i * 3]!;
      const ay = this.verts[e.i * 3 + 1]!;
      const az = this.verts[e.i * 3 + 2]!;
      const bx = this.verts[e.j * 3]!;
      const by = this.verts[e.j * 3 + 1]!;
      const bz = this.verts[e.j * 3 + 2]!;
      const o = s * 6;
      lines.positions[o] = ax;
      lines.positions[o + 1] = ay;
      lines.positions[o + 2] = az;
      lines.positions[o + 3] = bx;
      lines.positions[o + 4] = by;
      lines.positions[o + 5] = bz;
      lines.color[s] = e.color;
      lines.intensity[s] = e.intensity;
      lines.flags![s] = e.flags;
      s++;
    }
    const faces: FaceSet = {
      positions: new Float32Array(this.verts),
      indices: new Uint32Array(this.tris),
    };
    const points = createPointSet(this.pts.length, { size: true });
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]!;
      points.positions[i * 3] = p.x;
      points.positions[i * 3 + 1] = p.y;
      points.positions[i * 3 + 2] = p.z;
      points.color[i] = p.color;
      points.intensity[i] = p.intensity;
      points.size![i] = p.size;
    }
    return {
      lines,
      faces,
      points,
      bounds: padAabb(this.bounds),
      stats: {
        segments: n,
        triangles: (this.tris.length / 3) | 0,
        points: this.pts.length,
      },
      blinkMask: this.blinkMask,
    };
  }
}

function style(
  spec: PrimitiveSpec,
  opts: EmitOptions,
): {
  color: Beam;
  intensity: number;
  flags: number;
} {
  return {
    color: opts.color ?? PRIMITIVE_BEAM[spec.kind],
    intensity: opts.intensity ?? DEFAULT_BEAM_INTENSITY,
    flags: opts.flags ?? BeamFlag.DWELL,
  };
}

function makeBuilder(opts: EmitOptions): Builder {
  const b = new Builder();
  if (opts.maxSegments !== undefined) b.maxSegments = opts.maxSegments;
  return b;
}

/** Axis-aligned box wire + faces. Used by mid LOD and several primitives. */
export function emitAabb(
  b: Builder,
  min: Vec3,
  max: Vec3,
  color: number,
  intensity: number,
  flags: number,
  faces: boolean,
): void {
  const x0 = min.x,
    y0 = min.y,
    z0 = min.z;
  const x1 = max.x,
    y1 = max.y,
    z1 = max.z;
  const v = [
    b.vertex(x0, y0, z0),
    b.vertex(x1, y0, z0),
    b.vertex(x1, y1, z0),
    b.vertex(x0, y1, z0),
    b.vertex(x0, y0, z1),
    b.vertex(x1, y0, z1),
    b.vertex(x1, y1, z1),
    b.vertex(x0, y1, z1),
  ];
  const E: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [i, j] of E) b.edge(v[i]!, v[j]!, color, intensity, flags);
  if (faces) {
    b.quad(v[0]!, v[1]!, v[2]!, v[3]!);
    b.quad(v[5]!, v[4]!, v[7]!, v[6]!);
    b.quad(v[4]!, v[0]!, v[3]!, v[7]!);
    b.quad(v[1]!, v[5]!, v[6]!, v[2]!);
    b.quad(v[3]!, v[2]!, v[6]!, v[7]!);
    b.quad(v[4]!, v[5]!, v[1]!, v[0]!);
  }
}

function emitFaceGrid(
  b: Builder,
  ox: number,
  oy: number,
  oz: number,
  ux: number,
  uy: number,
  uz: number,
  vx: number,
  vy: number,
  vz: number,
  cellsU: number,
  cellsV: number,
  hatch: boolean,
  color: number,
  intensity: number,
  flags: number,
): void {
  const nu = cellsU + 1;
  const nv = cellsV + 1;
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    const tv = j / cellsV;
    for (let i = 0; i < nu; i++) {
      const tu = i / cellsU;
      idx.push(b.vertex(ox + ux * tu + vx * tv, oy + uy * tu + vy * tv, oz + uz * tu + vz * tv));
    }
  }
  for (let j = 0; j < cellsV; j++) {
    for (let i = 0; i < cellsU; i++) {
      const a = idx[j * nu + i]!;
      const c = idx[j * nu + i + 1]!;
      const d = idx[(j + 1) * nu + i + 1]!;
      const e = idx[(j + 1) * nu + i]!;
      b.edge(a, c, color, intensity, flags);
      b.edge(c, d, color, intensity, flags);
      b.edge(d, e, color, intensity, flags);
      b.edge(e, a, color, intensity, flags);
      b.quad(a, c, d, e);
      if (hatch) {
        b.edge(a, d, color, intensity * 0.55, flags);
        b.edge(c, e, color, intensity * 0.55, flags);
      }
    }
  }
}

function emitBoxAt(
  b: Builder,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  subdivisions: number,
  hatch: boolean,
  color: number,
  intensity: number,
  flags: number,
): void {
  const hw = w * 0.5,
    hh = h * 0.5,
    hd = d * 0.5;
  const cuts = Math.max(1, clampInt(subdivisions, 0, 8) + 1);
  if (subdivisions <= 0 && !hatch) {
    emitAabb(
      b,
      vec3(cx - hw, cy - hh, cz - hd),
      vec3(cx + hw, cy + hh, cz + hd),
      color,
      intensity,
      flags,
      true,
    );
    return;
  }
  const cu = cuts;
  emitFaceGrid(
    b,
    cx - hw,
    cy - hh,
    cz - hd,
    w,
    0,
    0,
    0,
    h,
    0,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
  emitFaceGrid(
    b,
    cx + hw,
    cy - hh,
    cz + hd,
    -w,
    0,
    0,
    0,
    h,
    0,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
  emitFaceGrid(
    b,
    cx - hw,
    cy - hh,
    cz + hd,
    w,
    0,
    0,
    0,
    0,
    -d,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
  emitFaceGrid(
    b,
    cx - hw,
    cy + hh,
    cz - hd,
    w,
    0,
    0,
    0,
    0,
    d,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
  emitFaceGrid(
    b,
    cx - hw,
    cy - hh,
    cz - hd,
    0,
    0,
    d,
    0,
    h,
    0,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
  emitFaceGrid(
    b,
    cx + hw,
    cy - hh,
    cz + hd,
    0,
    0,
    -d,
    0,
    h,
    0,
    cu,
    cu,
    hatch,
    color,
    intensity,
    flags,
  );
}

export function boundsOf(spec: PrimitiveSpec): Aabb {
  switch (spec.kind) {
    case 'box': {
      const hw = Math.abs(spec.w) * 0.5,
        hh = Math.abs(spec.h) * 0.5,
        hd = Math.abs(spec.d) * 0.5;
      return { min: vec3(-hw, -hh, -hd), max: vec3(hw, hh, hd) };
    }
    case 'slabTerrace': {
      const count = Math.max(1, spec.count);
      const h = Math.abs(spec.h);
      const spacing = Math.abs(spec.spacing);
      const totalH = count * h + (count - 1) * spacing;
      const w = Math.abs(spec.w);
      const wing = spec.symmetry ? w * 0.55 : 0;
      return {
        min: vec3(-w * 0.5 - wing, -totalH * 0.5, -Math.abs(spec.d) * 0.5),
        max: vec3(w * 0.5 + wing, totalH * 0.5, Math.abs(spec.d) * 0.5),
      };
    }
    case 'cubeStack': {
      const n = Math.max(1, spec.n),
        m = Math.max(1, spec.m),
        k = Math.max(1, spec.k);
      const gap = Math.max(0, spec.gap);
      const pitch = 1 + gap;
      return {
        min: vec3(-n * pitch * 0.5, -m * pitch * 0.5, -k * pitch * 0.5),
        max: vec3(n * pitch * 0.5, m * pitch * 0.5, k * pitch * 0.5),
      };
    }
    case 'ziggurat': {
      const steps = Math.max(1, spec.steps);
      const base = Math.abs(spec.base);
      const h = steps * Math.abs(spec.stepH);
      return {
        min: vec3(-base * 0.5, -h * 0.5, -base * 0.5),
        max: vec3(base * 0.5, h * 0.5, base * 0.5),
      };
    }
    case 'mast': {
      const h = Math.abs(spec.height);
      const r = Math.max(2, h * 0.12);
      return { min: vec3(-r, -h * 0.5, -r), max: vec3(r, h * 0.5, r) };
    }
    case 'nestedPoly': {
      const r = spec.radius ?? 8;
      return { min: vec3(-r, -r, -r), max: vec3(r, r, r) };
    }
    case 'geodesic': {
      const r = Math.abs(spec.radius);
      return { min: vec3(-r, -r, -r), max: vec3(r, r, r) };
    }
    case 'tower': {
      const h = Math.abs(spec.height);
      const r = h * 0.22;
      return { min: vec3(-r, -h * 0.5, -r), max: vec3(r, h * 0.5, r) };
    }
    case 'constellation':
    case 'spiralArms': {
      const r = spec.kind === 'spiralArms' ? 12 : 8;
      return { min: vec3(-r, -r, -r), max: vec3(r, r, r) };
    }
  }
}

function emitBox(spec: BoxParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const w = clampNum(spec.w, 0.1, 256);
  const h = clampNum(spec.h, 0.1, 256);
  const d = clampNum(spec.d, 0.1, 256);
  emitBoxAt(b, 0, 0, 0, w, h, d, spec.subdivisions, spec.hatch, color, intensity, flags);
  return b.freeze();
}

function emitSlabTerrace(spec: SlabTerraceParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const count = clampInt(spec.count, 1, 24);
  const w = clampNum(spec.w, 0.2, 256);
  const h = clampNum(spec.h, 0.1, 64);
  const d = clampNum(spec.d, 0.2, 256);
  const spacing = clampNum(spec.spacing, 0, 64);
  const totalH = count * h + (count - 1) * spacing;
  const y0 = -totalH * 0.5 + h * 0.5;
  const xs = spec.symmetry ? [-w * 0.55, w * 0.55] : [0];
  for (let i = 0; i < count; i++) {
    const y = y0 + i * (h + spacing);
    const recede = 1 - i * 0.06;
    for (const x of xs) {
      emitBoxAt(b, x, y, 0, w * recede, h, d * recede, 0, false, color, intensity, flags);
    }
  }
  return b.freeze();
}

function emitCubeStack(spec: CubeStackParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const n = clampInt(spec.n, 1, 12);
  const m = clampInt(spec.m, 1, 12);
  const k = clampInt(spec.k, 1, 12);
  const gap = clampNum(spec.gap, 0, 0.95);
  const cube = Math.max(0.05, 1 - gap);
  const pitch = 1 + gap;
  const ox = -((n - 1) * pitch) * 0.5;
  const oy = -((m - 1) * pitch) * 0.5;
  const oz = -((k - 1) * pitch) * 0.5;
  const total = n * m * k;
  const mask = new Uint8Array(total);
  if (spec.blinkMask instanceof Uint8Array) {
    mask.set(spec.blinkMask.subarray(0, total));
    if (spec.blinkMask.length < total) {
      for (let i = spec.blinkMask.length; i < total; i++) mask[i] = 1;
    }
  } else if (spec.blinkMask === true) {
    for (let i = 0; i < total; i++) mask[i] = (i + ((i / n) | 0)) % 2 === 0 ? 1 : 0;
  } else {
    mask.fill(1);
  }
  b.blinkMask = mask;
  const useLattice = 12 * total > (opts.maxSegments ?? Infinity) && gap < 0.05;
  if (useLattice) {
    emitAabb(
      b,
      vec3(ox - cube * 0.5, oy - cube * 0.5, oz - cube * 0.5),
      vec3(
        ox + (n - 1) * pitch + cube * 0.5,
        oy + (m - 1) * pitch + cube * 0.5,
        oz + (k - 1) * pitch + cube * 0.5,
      ),
      color,
      intensity,
      flags,
      true,
    );
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        const x = ox + i * pitch;
        const y = oy + j * pitch;
        const a = b.vertex(x, y, oz);
        const c = b.vertex(x, y, oz + (k - 1) * pitch);
        b.edge(a, c, color, intensity, flags);
      }
    }
    return b.freeze();
  }
  for (let z = 0; z < k; z++) {
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < n; x++) {
        const id = x + n * (y + m * z);
        if (mask[id] === 0) continue;
        emitBoxAt(
          b,
          ox + x * pitch,
          oy + y * pitch,
          oz + z * pitch,
          cube,
          cube,
          cube,
          0,
          false,
          color,
          intensity,
          flags,
        );
      }
    }
  }
  return b.freeze();
}

function emitZiggurat(spec: ZigguratParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const steps = clampInt(spec.steps, 1, 16);
  const base = clampNum(spec.base, 1, 256);
  const stepH = clampNum(spec.stepH, 0.1, 64);
  const inset = clampNum(spec.inset, 0, base * 0.45);
  const totalH = steps * stepH;
  const y0 = -totalH * 0.5 + stepH * 0.5;
  for (let i = 0; i < steps; i++) {
    const size = Math.max(0.4, base - i * inset * 2);
    emitBoxAt(b, 0, y0 + i * stepH, 0, size, stepH, size, 0, false, color, intensity, flags);
  }
  return b.freeze();
}

function emitMast(spec: MastParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const height = clampNum(spec.height, 1, 256);
  const sections = clampInt(spec.sections, 1, 16);
  const dishes = clampInt(spec.dishes, 0, 8);
  const half = height * 0.5;
  const span = Math.max(0.6, height * 0.045);
  const yOf = (t: number): number => -half + t * height;
  const ring = (y: number, s: number): number[] => {
    const p = [b.vertex(-s, y, -s), b.vertex(s, y, -s), b.vertex(s, y, s), b.vertex(-s, y, s)];
    b.edge(p[0]!, p[1]!, color, intensity, flags);
    b.edge(p[1]!, p[2]!, color, intensity, flags);
    b.edge(p[2]!, p[3]!, color, intensity, flags);
    b.edge(p[3]!, p[0]!, color, intensity, flags);
    return p;
  };
  let prev = ring(yOf(0), span);
  for (let i = 1; i <= sections; i++) {
    const y = yOf(i / sections);
    const cur = ring(y, span);
    for (let c = 0; c < 4; c++) {
      b.edge(prev[c]!, cur[c]!, color, intensity, flags);
      b.edge(prev[c]!, cur[(c + 1) % 4]!, color, intensity * 0.7, flags);
    }
    prev = cur;
  }
  const dishSegs = 12;
  for (let d = 0; d < dishes; d++) {
    const t = (d + 1) / (dishes + 1);
    const y = yOf(t);
    const r = span * (2.2 + d * 0.35);
    const ids: number[] = [];
    for (let i = 0; i < dishSegs; i++) {
      const a = (i / dishSegs) * Math.PI * 2;
      ids.push(b.vertex(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    for (let i = 0; i < dishSegs; i++) {
      b.edge(ids[i]!, ids[(i + 1) % dishSegs]!, color, intensity, flags);
    }
    const hub = b.vertex(0, y, 0);
    b.edge(hub, ids[0]!, color, intensity, flags);
    b.edge(hub, ids[(dishSegs / 2) | 0]!, color, intensity, flags);
    for (let i = 1; i < dishSegs - 1; i++) b.tri(hub, ids[i]!, ids[i + 1]!);
  }
  return b.freeze();
}

type TriMesh = { verts: Vec3[]; faces: Array<[number, number, number]> };

function rotateVert(v: Vec3, axis: AxisId, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  if (axis === 0) return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  if (axis === 1) return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

function scaleVert(v: Vec3, r: number): Vec3 {
  return vec3(v.x * r, v.y * r, v.z * r);
}

function tetraMesh(): TriMesh {
  const verts = [vec3(1, 1, 1), vec3(1, -1, -1), vec3(-1, 1, -1), vec3(-1, -1, 1)];
  const faces: Array<[number, number, number]> = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  return { verts, faces };
}

function octaMesh(): TriMesh {
  const verts = [
    vec3(1, 0, 0),
    vec3(-1, 0, 0),
    vec3(0, 1, 0),
    vec3(0, -1, 0),
    vec3(0, 0, 1),
    vec3(0, 0, -1),
  ];
  const faces: Array<[number, number, number]> = [
    [0, 2, 4],
    [0, 4, 3],
    [0, 3, 5],
    [0, 5, 2],
    [1, 4, 2],
    [1, 3, 4],
    [1, 5, 3],
    [1, 2, 5],
  ];
  return { verts, faces };
}

function icosaMesh(): TriMesh {
  const t = PHI;
  const raw: Vec3[] = [
    vec3(-1, t, 0),
    vec3(1, t, 0),
    vec3(-1, -t, 0),
    vec3(1, -t, 0),
    vec3(0, -1, t),
    vec3(0, 1, t),
    vec3(0, -1, -t),
    vec3(0, 1, -t),
    vec3(t, 0, -1),
    vec3(t, 0, 1),
    vec3(-t, 0, -1),
    vec3(-t, 0, 1),
  ];
  const faces: Array<[number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return { verts: raw, faces };
}

function solidMesh(solid: SolidKind): TriMesh {
  if (solid === 'tetra') return tetraMesh();
  if (solid === 'octa') return octaMesh();
  return icosaMesh();
}

function emitMesh(
  b: Builder,
  mesh: TriMesh,
  radius: number,
  axis: AxisId,
  ang: number,
  hatch: boolean,
  color: number,
  intensity: number,
  flags: number,
): void {
  const ids: number[] = [];
  for (const v of mesh.verts) {
    const r = rotateVert(scaleVert(v, radius / Math.hypot(v.x, v.y, v.z) || radius), axis, ang);
    ids.push(b.vertex(r.x, r.y, r.z));
  }
  for (const [i, j, k] of mesh.faces) {
    const a = ids[i]!,
      c = ids[j]!,
      d = ids[k]!;
    b.edge(a, c, color, intensity, flags);
    b.edge(c, d, color, intensity, flags);
    b.edge(d, a, color, intensity, flags);
    b.tri(a, c, d);
    if (hatch) {
      const mid = (p: number, q: number): number => {
        const pv = mesh.verts[p]!;
        const qv = mesh.verts[q]!;
        const mxv = (pv.x + qv.x) * 0.5;
        const myv = (pv.y + qv.y) * 0.5;
        const mzv = (pv.z + qv.z) * 0.5;
        const len = Math.hypot(mxv, myv, mzv) || 1;
        const r = rotateVert(scaleVert(vec3(mxv, myv, mzv), radius / len), axis, ang);
        return b.vertex(r.x, r.y, r.z);
      };
      const mab = mid(i, j);
      const mbc = mid(j, k);
      const mca = mid(k, i);
      b.edge(mab, mbc, color, intensity * 0.55, flags);
      b.edge(mbc, mca, color, intensity * 0.55, flags);
      b.edge(mca, mab, color, intensity * 0.55, flags);
    }
  }
}

function emitNestedPoly(spec: NestedPolyParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const shells = clampInt(spec.shells, 1, 8);
  const radius = clampNum(spec.radius ?? 8, 0.5, 128);
  const axes = spec.rotationAxes.length > 0 ? spec.rotationAxes : ([0, 1, 2] as const);
  const mesh = solidMesh(spec.solid);
  const hatch = spec.hatch === true;
  for (let i = 0; i < shells; i++) {
    const t = shells === 1 ? 1 : 1 - i / shells;
    const r = radius * Math.max(0.2, t);
    const axis = axes[i % axes.length]!;
    const ang = i * 0.41;
    emitMesh(b, mesh, r, axis, ang, hatch, color, intensity * (0.7 + 0.3 * t), flags);
  }
  return b.freeze();
}

function subdivideIcosa(freq: number, radius: number): TriMesh {
  const base = icosaMesh();
  let verts = base.verts.map((v) => {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return vec3((v.x / len) * radius, (v.y / len) * radius, (v.z / len) * radius);
  });
  let faces = base.faces.slice();
  const iterations = Math.max(0, freq - 1);
  for (let n = 0; n < iterations; n++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo},${hi}`;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a]!;
      const vb = verts[b]!;
      const x = (va.x + vb.x) * 0.5;
      const y = (va.y + vb.y) * 0.5;
      const z = (va.z + vb.z) * 0.5;
      const len = Math.hypot(x, y, z) || 1;
      const i = verts.length;
      verts = verts.concat([vec3((x / len) * radius, (y / len) * radius, (z / len) * radius)]);
      mid.set(key, i);
      return i;
    };
    const next: Array<[number, number, number]> = [];
    for (const [i, j, k] of faces) {
      const a = midpoint(i, j);
      const c = midpoint(j, k);
      const d = midpoint(k, i);
      next.push([i, a, d], [a, j, c], [d, c, k], [a, c, d]);
    }
    faces = next;
  }
  return { verts, faces };
}

function emitGeodesic(spec: GeodesicParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const frequency = clampInt(spec.frequency, 1, 4);
  const radius = clampNum(spec.radius, 0.5, 256);
  const mesh = subdivideIcosa(frequency, radius);
  const ids = mesh.verts.map((v) => b.vertex(v.x, v.y, v.z));
  for (const [i, j, k] of mesh.faces) {
    const a = ids[i]!,
      c = ids[j]!,
      d = ids[k]!;
    b.edge(a, c, color, intensity, flags);
    b.edge(c, d, color, intensity, flags);
    b.edge(d, a, color, intensity, flags);
    b.tri(a, c, d);
  }
  return b.freeze();
}

function emitTower(spec: TowerParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity, flags } = style(spec, opts);
  const sides = clampInt(spec.sides, 3, 12);
  const height = clampNum(spec.height, 1, 256);
  const taper = clampNum(spec.taper, 0, 0.95);
  const rings = clampInt(spec.rings, 2, 16);
  const half = height * 0.5;
  const r0 = height * 0.2;
  const r1 = r0 * (1 - taper);
  const ringIds: number[][] = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const y = -half + t * height;
    const rad = r0 + (r1 - r0) * t;
    const ids: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      ids.push(b.vertex(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
    for (let i = 0; i < sides; i++) {
      b.edge(ids[i]!, ids[(i + 1) % sides]!, color, intensity, flags);
    }
    ringIds.push(ids);
  }
  for (let r = 0; r < rings - 1; r++) {
    const a = ringIds[r]!;
    const c = ringIds[r + 1]!;
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      b.edge(a[i]!, c[i]!, color, intensity, flags);
      b.quad(a[i]!, a[i1]!, c[i1]!, c[i]!);
    }
  }
  return b.freeze();
}

function emitConstellation(spec: ConstellationParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity } = style(spec, opts);
  const n = clampInt(spec.n, 1, 4096);
  const radius = 8;
  const rng = opts.rng;
  const dist = spec.distribution;
  if (dist === 'uniform-sphere' || !rng) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const denom = Math.max(n - 1, 1);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / denom) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      b.point(
        Math.cos(theta) * r * radius,
        y * radius,
        Math.sin(theta) * r * radius,
        color,
        intensity,
      );
    }
  } else if (dist === 'gaussian') {
    for (let i = 0; i < n; i++) {
      b.point(
        rng.normal(0, radius / 3),
        rng.normal(0, radius / 3),
        rng.normal(0, radius / 3),
        color,
        intensity,
      );
    }
  } else if (dist === 'grid') {
    const side = Math.max(2, Math.ceil(Math.cbrt(n)));
    const step = (radius * 2) / (side - 1 || 1);
    let count = 0;
    for (let z = 0; z < side && count < n; z++) {
      for (let y = 0; y < side && count < n; y++) {
        for (let x = 0; x < side && count < n; x++) {
          const jx = (rng.float(-0.3, 0.3) * step) / 2;
          const jy = (rng.float(-0.3, 0.3) * step) / 2;
          const jz = (rng.float(-0.3, 0.3) * step) / 2;
          b.point(
            -radius + x * step + jx,
            -radius + y * step + jy,
            -radius + z * step + jz,
            color,
            intensity,
          );
          count++;
        }
      }
    }
  } else {
    const blobs = 4;
    const centers: Vec3[] = [];
    for (let i = 0; i < blobs; i++) {
      centers.push(
        vec3(
          rng.float(-radius * 0.6, radius * 0.6),
          rng.float(-radius * 0.6, radius * 0.6),
          rng.float(-radius * 0.6, radius * 0.6),
        ),
      );
    }
    for (let i = 0; i < n; i++) {
      const c = centers[i % blobs]!;
      b.point(
        c.x + rng.normal(0, radius * 0.18),
        c.y + rng.normal(0, radius * 0.18),
        c.z + rng.normal(0, radius * 0.18),
        color,
        intensity,
      );
    }
  }
  return b.freeze();
}

function emitSpiralArms(spec: SpiralArmsParams, opts: EmitOptions): ConstructGeometry {
  const b = makeBuilder(opts);
  const { color, intensity } = style(spec, opts);
  const arms = clampInt(spec.arms, 1, 8);
  const points = clampInt(spec.points, 2, 8000);
  const pitch = clampNum(spec.pitch, 0.02, 1.2);
  const turns = 2.2;
  const scale = 12;
  for (let arm = 0; arm < arms; arm++) {
    const off = (Math.PI * 2 * arm) / arms;
    for (let i = 0; i < points; i++) {
      const t = i / Math.max(points - 1, 1);
      const theta = t * Math.PI * 2 * turns;
      const r = (Math.exp(pitch * theta) - 1) / (Math.exp(pitch * Math.PI * 2 * turns) - 1 || 1);
      const x = r * Math.cos(theta + off) * scale;
      const z = r * Math.sin(theta + off) * scale;
      const y = (t - 0.5) * 0.15 * scale * r;
      b.point(x, y, z, color, intensity, DEFAULT_POINT_SIZE * (0.7 + t * 0.6));
    }
  }
  return b.freeze();
}

export function emitPrimitive(spec: PrimitiveSpec, opts: EmitOptions = {}): ConstructGeometry {
  switch (spec.kind) {
    case 'box':
      return emitBox(spec, opts);
    case 'slabTerrace':
      return emitSlabTerrace(spec, opts);
    case 'cubeStack':
      return emitCubeStack(spec, opts);
    case 'ziggurat':
      return emitZiggurat(spec, opts);
    case 'mast':
      return emitMast(spec, opts);
    case 'nestedPoly':
      return emitNestedPoly(spec, opts);
    case 'geodesic':
      return emitGeodesic(spec, opts);
    case 'tower':
      return emitTower(spec, opts);
    case 'constellation':
      return emitConstellation(spec, opts);
    case 'spiralArms':
      return emitSpiralArms(spec, opts);
  }
}
