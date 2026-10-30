/**
 * Authored landmarks (plan §8.6, M2.2). Fixed coordinates, always loaded as
 * far-LOD lightpoints by M2.3; full geometry is the construct grammar at the
 * corp's heraldry. Missions reference landmarks by `id`.
 */

import type { TempoClock } from '../audio/music/Sequencer';
import type { Vec3 } from '../core/math/vec3';
import { Beam, createLineSet, type LineSet } from '../render/lines/BeamBatch';
import { createPointSet, type PointSet } from '../render/points/PointBatch';
import { SECTOR_SIZE, type MatrixCoord } from '../world/coords';
import {
  generate,
  type ConstructGeometry,
  type FaceSet,
  type GenerateOptions,
  type LodLevel,
  type PrimitiveSpec,
} from '../world/constructs/grammar';
import {
  asTempoClock,
  CORPS,
  corpPulse,
  ledgerBlinkMask,
  type CorpId,
  type RhythmKind,
} from './corps';

export const LANDMARK_IDS = [
  'ta-straylight',
  'ta-berne',
  'mitsubishi-boa',
  'esfa',
  'sense-net',
  'hosaka',
  'turing-geneva',
  'chiba-node',
  'hosaka-m3',
] as const;
export type LandmarkId = (typeof LANDMARK_IDS)[number];

export const REGION_CODES = ['BAMA', 'CHBA', 'EURO', 'RIO', 'ORBT'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export interface LandmarkPart {
  spec: PrimitiveSpec;
  color?: Beam;
  intensity?: number;
}

export interface LandmarkDef {
  id: LandmarkId;
  /** Display name; defaults to the corp name when omitted. */
  name?: string;
  corp: CorpId;
  coords: MatrixCoord;
  /** Far-LOD point size weight (plan §8.6). */
  importance: number;
  parts: readonly LandmarkPart[];
  /** Override the corp's default rhythm (Berne listens; T-A breathes). */
  rhythm?: RhythmKind;
}

export const LANDMARKS: readonly LandmarkDef[] = [
  {
    id: 'ta-straylight',
    name: 'Villa Straylight',
    corp: 'tessierAshpool',
    coords: { region: 'ORBT', x: 320.0, z: 40.0, y: 5600 },
    importance: 8,
    parts: [
      {
        spec: {
          kind: 'slabTerrace',
          count: 11,
          spacing: 1.1,
          w: 36,
          h: 2.4,
          d: 11,
          symmetry: true,
        },
      },
    ],
  },
  {
    id: 'ta-berne',
    name: 'T-A Berne',
    corp: 'tessierAshpool',
    coords: { region: 'EURO', x: 246.4, z: 74.8, y: 3200 },
    importance: 7,
    rhythm: 'listen',
    parts: [
      {
        spec: {
          kind: 'slabTerrace',
          count: 4,
          spacing: 1.8,
          w: 22,
          h: 2,
          d: 14,
          symmetry: true,
        },
      },
      {
        spec: { kind: 'box', w: 4, h: 4, d: 4, subdivisions: 1, hatch: true },
        color: Beam.ICE,
        intensity: 2.6,
      },
    ],
  },
  {
    id: 'mitsubishi-boa',
    corp: 'mitsubishi',
    coords: { region: 'BAMA', x: 172.0, z: 94.1, y: 380 },
    importance: 6,
    parts: [{ spec: CORPS.mitsubishi.spec }],
  },
  {
    id: 'esfa',
    corp: 'esfa',
    coords: { region: 'BAMA', x: 160.5, z: 100.0, y: 520 },
    importance: 7,
    parts: [{ spec: CORPS.esfa.spec }],
  },
  {
    id: 'sense-net',
    corp: 'senseNet',
    coords: { region: 'BAMA', x: 168.25, z: 96.4, y: 420 },
    importance: 6,
    parts: [{ spec: CORPS.senseNet.spec }],
  },
  {
    id: 'hosaka',
    corp: 'hosaka',
    coords: { region: 'CHBA', x: 408.0, z: 176.5, y: 640 },
    importance: 6,
    parts: [
      {
        spec: {
          kind: 'nestedPoly',
          solid: 'octa',
          shells: 2,
          rotationAxes: [0, 2],
          radius: 9,
          hatch: true,
        },
      },
      {
        spec: {
          kind: 'nestedPoly',
          solid: 'octa',
          shells: 2,
          rotationAxes: [1],
          radius: 5,
          hatch: true,
        },
        color: Beam.ICE,
        intensity: 1.15,
      },
    ],
  },
  {
    id: 'turing-geneva',
    name: 'Turing Registry, Geneva',
    corp: 'turing',
    coords: { region: 'EURO', x: 248.0, z: 72.0, y: 1800 },
    importance: 5,
    parts: [{ spec: CORPS.turing.spec }],
  },
  {
    id: 'chiba-node',
    name: 'Chiba black-clinic node',
    corp: 'minor',
    coords: { region: 'CHBA', x: 412.9, z: 180.2, y: 160 },
    importance: 3,
    parts: [{ spec: { kind: 'tower', sides: 4, height: 14, taper: 0.26, rings: 4 } }],
  },
  {
    id: 'hosaka-m3',
    name: 'Hosaka node (M3)',
    corp: 'hosaka',
    coords: { region: 'BAMA', x: 180.12, z: 102.4, y: 280 },
    importance: 4,
    parts: [
      {
        spec: {
          kind: 'nestedPoly',
          solid: 'octa',
          shells: 2,
          rotationAxes: [0, 1],
          radius: 6,
          hatch: false,
        },
      },
    ],
  },
];

const BY_ID: Record<LandmarkId, LandmarkDef> = Object.fromEntries(
  LANDMARKS.map((l) => [l.id, l]),
) as Record<LandmarkId, LandmarkDef>;

export function isLandmarkId(v: string): v is LandmarkId {
  return (LANDMARK_IDS as readonly string[]).includes(v);
}

export function getLandmark(id: string): LandmarkDef | undefined {
  return isLandmarkId(id) ? BY_ID[id] : undefined;
}

export function parseLandmarkId(raw: string | null | undefined): LandmarkId | null {
  if (!raw) return null;
  const id = raw.trim();
  return isLandmarkId(id) ? id : null;
}

/** Sector.fraction × SECTOR_SIZE, altitude already in world units. */
export function landmarkWorldPos(coords: MatrixCoord): Vec3 {
  return { x: coords.x * SECTOR_SIZE, y: coords.y, z: coords.z * SECTOR_SIZE };
}

export function landmarkRhythm(def: LandmarkDef): RhythmKind {
  return def.rhythm ?? CORPS[def.corp].rhythm;
}

function cloneSpec(spec: PrimitiveSpec): PrimitiveSpec {
  if (spec.kind === 'nestedPoly') {
    return { ...spec, rotationAxes: spec.rotationAxes.slice() };
  }
  if (spec.kind === 'cubeStack') {
    const blink =
      spec.blinkMask instanceof Uint8Array ? new Uint8Array(spec.blinkMask) : spec.blinkMask;
    return { ...spec, blinkMask: blink };
  }
  return { ...spec };
}

function unionAabb(
  a: ConstructGeometry['bounds'],
  b: ConstructGeometry['bounds'],
): ConstructGeometry['bounds'] {
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

function mergeLineSets(sets: LineSet[]): LineSet {
  const n = sets.reduce((s, x) => s + x.color.length, 0);
  const wantW = sets.some((s) => s.width);
  const wantF = sets.some((s) => s.flags);
  const out = createLineSet(n, { width: wantW, flags: wantF });
  let o = 0;
  for (const set of sets) {
    out.positions.set(set.positions, o * 6);
    out.color.set(set.color, o);
    out.intensity.set(set.intensity, o);
    if (out.width) out.width.set(set.width ?? new Float32Array(set.color.length).fill(1.5), o);
    if (out.flags) out.flags.set(set.flags ?? new Uint8Array(set.color.length), o);
    o += set.color.length;
  }
  return out;
}

function mergePointSets(sets: PointSet[]): PointSet {
  const n = sets.reduce((s, x) => s + x.color.length, 0);
  const out = createPointSet(n, { size: true });
  let o = 0;
  for (const set of sets) {
    out.positions.set(set.positions, o * 3);
    out.color.set(set.color, o);
    out.intensity.set(set.intensity, o);
    if (out.size) {
      out.size.set(set.size ?? new Float32Array(set.color.length).fill(1.5), o);
    }
    o += set.color.length;
  }
  return out;
}

function mergeFaceSets(sets: FaceSet[]): FaceSet {
  let v = 0;
  let t = 0;
  for (const s of sets) {
    v += s.positions.length / 3;
    t += s.indices.length;
  }
  const positions = new Float32Array(v * 3);
  const indices = new Uint32Array(t);
  let vo = 0;
  let io = 0;
  let vBase = 0;
  for (const s of sets) {
    positions.set(s.positions, vo);
    for (let i = 0; i < s.indices.length; i++) indices[io + i] = s.indices[i]! + vBase;
    vo += s.positions.length;
    io += s.indices.length;
    vBase += s.positions.length / 3;
  }
  return { positions, indices };
}

export function mergeGeometries(parts: readonly ConstructGeometry[]): ConstructGeometry {
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 0) {
    return generate(
      { kind: 'box', w: 1, h: 1, d: 1, subdivisions: 0, hatch: false },
      { lod: 'far' },
    );
  }
  const lines = mergeLineSets(parts.map((p) => p.lines));
  const points = mergePointSets(parts.map((p) => p.points));
  const faces = mergeFaceSets(parts.map((p) => p.faces));
  let bounds = parts[0]!.bounds;
  let segs = 0;
  let tris = 0;
  let pts = 0;
  for (const p of parts) {
    bounds = unionAabb(bounds, p.bounds);
    segs += p.stats.segments;
    tris += p.stats.triangles;
    pts += p.stats.points;
  }
  return {
    lines,
    faces,
    points,
    bounds,
    stats: { segments: segs, triangles: tris, points: pts },
    blinkMask: parts.find((p) => p.blinkMask)?.blinkMask,
  };
}

export interface LandmarkGenerateOptions extends GenerateOptions {
  t?: number;
  tempo?: number | TempoClock;
}

function partSpec(
  def: LandmarkDef,
  part: LandmarkPart,
  opts: LandmarkGenerateOptions,
): PrimitiveSpec {
  const spec = cloneSpec(part.spec);
  if (spec.kind === 'cubeStack' && landmarkRhythm(def) === 'ledger') {
    spec.blinkMask = ledgerBlinkMask(
      spec.n,
      spec.m,
      spec.k,
      opts.t ?? 0,
      opts.tempo,
      opts.seed ?? 1,
    );
  }
  return spec;
}

/** Generate each authored part at the requested LOD (near default). */
export function generateLandmarkParts(
  id: LandmarkId,
  opts: LandmarkGenerateOptions = {},
): ConstructGeometry[] {
  const def = BY_ID[id];
  const lod: LodLevel = opts.lod ?? 'near';
  return def.parts.map((part) =>
    generate(partSpec(def, part, opts), {
      lod,
      seed: opts.seed ?? 1,
      color: part.color ?? CORPS[def.corp].hues[0],
      intensity: part.intensity,
      importance: def.importance,
    }),
  );
}

export function generateLandmark(
  id: LandmarkId,
  opts: LandmarkGenerateOptions = {},
): ConstructGeometry {
  const lod: LodLevel = opts.lod ?? 'near';
  if (lod === 'far') {
    const def = BY_ID[id];
    const part = def.parts[0]!;
    return generate(partSpec(def, part, opts), {
      lod: 'far',
      seed: opts.seed ?? 1,
      color: part.color ?? CORPS[def.corp].hues[0],
      intensity: part.intensity,
      importance: def.importance,
    });
  }
  return mergeGeometries(generateLandmarkParts(id, opts));
}

/** Live corp pulse for a landmark (rhythm override + tempo clock). */
export function landmarkPulse(
  id: LandmarkId,
  t: number,
  tempo: number | TempoClock = 96,
): ReturnType<typeof corpPulse> {
  const def = BY_ID[id];
  return corpPulse(def.corp, t, asTempoClock(tempo), landmarkRhythm(def));
}
