/**
 * Per-sector procedural population (plan §8.6). Pure function of
 * `(sx, sz, worldSeed)` plus the density/region rasters. Does not import the
 * construct grammar module — `sampleSpec` lives there next to emitters that
 * pull BeamBatch/Three, which must not enter the sector worker bundle.
 *
 * Parameter ranges match M2.1 `sampleSpec`. Tests call `generate()` on the
 * resulting specs to prove they still drive the grammar.
 */

import { hash2i, hashCombine, hashString } from '../core/hash';
import { pcg32, type Pcg32 } from '../core/rng';
import {
  MAJOR_GRID,
  MINOR_GRID,
  SECTOR_SIZE,
  clampSectorIndex,
  sectorOrigin,
  snapToGrid,
} from './coords';
import type { DensityMaps, RegionCode } from './densityMap';
import { landmarkWorld, nearestLandmark, type LandmarkDef } from './landmarks';
import { clusterLinks, manhattanRoute, routeToward } from './traffic/routing';
import type { Distribution, PrimitiveKind, PrimitiveSpec, SolidKind } from './constructs/grammar';

export const DEFAULT_WORLD_SEED = 1;
export const TEMPO_SET = [48, 72, 96, 120] as const;
export const TRUNK_LENGTH = 512;
export const EXTRA_EDGE_RATIO = 0.2;

/** Beam indices as literals (do not import BeamBatch into the worker). */
const HUE = {
  GRID: 0,
  MITSU: 2,
  TA: 3,
  ESFA: 4,
  AMBER: 5,
  ICE: 6,
  MIL: 7,
} as const;

const MINOR_GRAMMARS: readonly PrimitiveKind[] = [
  'box',
  'slabTerrace',
  'cubeStack',
  'ziggurat',
  'mast',
  'nestedPoly',
  'geodesic',
  'tower',
  'constellation',
];

const REGION_KINDS: Record<RegionCode, readonly PrimitiveKind[]> = {
  VOID: ['constellation', 'box'],
  BAMA: ['box', 'cubeStack', 'tower', 'mast', 'ziggurat'],
  CHBA: ['cubeStack', 'nestedPoly', 'tower', 'mast'],
  EURO: ['geodesic', 'nestedPoly', 'slabTerrace', 'tower'],
  RIO: ['tower', 'box', 'ziggurat', 'constellation'],
  ORBT: ['slabTerrace', 'mast', 'nestedPoly'],
};

const REGION_HUES: Record<RegionCode, readonly number[]> = {
  VOID: [HUE.GRID],
  BAMA: [HUE.GRID, HUE.MITSU, HUE.AMBER, HUE.ESFA],
  CHBA: [HUE.MITSU, HUE.GRID, HUE.AMBER],
  EURO: [HUE.MIL, HUE.TA, HUE.ICE],
  RIO: [HUE.AMBER, HUE.ESFA, HUE.GRID],
  ORBT: [HUE.TA, HUE.MIL],
};

export interface ConstructInstance {
  id: string;
  sx: number;
  sz: number;
  x: number;
  y: number;
  z: number;
  kind: PrimitiveKind;
  spec: PrimitiveSpec;
  color: number;
  intensity: number;
  importance: number;
  /** BPM from TEMPO_SET; renderer pulse(t, bpm). */
  rhythmBpm: number;
  seed: number;
}

export interface ClusterRecord {
  x: number;
  z: number;
  count: number;
}

export interface SectorTraffic {
  a: number;
  b: number;
  kind: 'cluster' | 'extra' | 'trunk';
  path: number[];
}

export interface WatcherInstance {
  x: number;
  y: number;
  z: number;
  kind: 'turing' | 'sysop';
}

export interface SectorData {
  sx: number;
  sz: number;
  worldSeed: number;
  region: RegionCode;
  density: number;
  constructs: ConstructInstance[];
  clusters: ClusterRecord[];
  traffic: SectorTraffic[];
  watchers: WatcherInstance[];
  /** Deterministic fingerprint of contents (positions, kinds, traffic count). */
  contentHash: number;
}

export interface GenerateSectorRequest {
  sx: number;
  sz: number;
  worldSeed: number;
  maps: DensityMaps;
  landmarks: readonly LandmarkDef[];
}

/** Same ranges as M2.1 `sampleSpec` (grammar.ts). */
export function sampleMinorSpec(kind: PrimitiveKind, rng: Pcg32): PrimitiveSpec {
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

function heightFor(rng: Pcg32, region: RegionCode, density: number): number {
  if (region === 'ORBT') return snapToGrid(rng.float(2000, 8000), MINOR_GRID);
  const roll = rng.next();
  if (roll < 0.08 + density * 0.04) return snapToGrid(rng.float(2000, 6000), MINOR_GRID);
  if (roll < 0.35 + density * 0.15) return snapToGrid(rng.float(200, 2000), MINOR_GRID);
  return snapToGrid(rng.float(16, 200), MINOR_GRID);
}

function importanceOf(kind: PrimitiveKind, y: number): number {
  const tall = y / 1000;
  const bonus =
    kind === 'ziggurat' || kind === 'geodesic' || kind === 'slabTerrace'
      ? 1.5
      : kind === 'cubeStack' || kind === 'nestedPoly'
        ? 1
        : 0.4;
  return tall + bonus;
}

function specExtent(spec: PrimitiveSpec): { w: number; h: number; d: number } {
  switch (spec.kind) {
    case 'box':
      return { w: spec.w, h: spec.h, d: spec.d };
    case 'slabTerrace':
      return { w: spec.w, h: spec.count * (spec.h + spec.spacing), d: spec.d };
    case 'cubeStack':
      return { w: spec.n * 4, h: spec.k * 4, d: spec.m * 4 };
    case 'ziggurat':
      return { w: spec.base, h: spec.steps * spec.stepH, d: spec.base };
    case 'mast':
      return { w: 6, h: spec.height, d: 6 };
    case 'nestedPoly':
      return { w: (spec.radius ?? 8) * 2, h: (spec.radius ?? 8) * 2, d: (spec.radius ?? 8) * 2 };
    case 'geodesic':
      return { w: spec.radius * 2, h: spec.radius * 2, d: spec.radius * 2 };
    case 'tower':
      return { w: 10, h: spec.height, d: 10 };
    case 'constellation':
      return { w: 12, h: 12, d: 12 };
    case 'spiralArms':
      return { w: 20, h: 4, d: 20 };
  }
}

export function constructExtent(spec: PrimitiveSpec): { w: number; h: number; d: number } {
  return specExtent(spec);
}

function hashData(data: SectorData): number {
  let h = hash2i(data.sx, data.sz, data.worldSeed);
  h = hashCombine(h, data.constructs.length);
  for (const c of data.constructs) {
    h = hashCombine(h, c.x);
    h = hashCombine(h, c.y);
    h = hashCombine(h, c.z);
    h = hashCombine(h, hashString(c.kind));
    h = hashCombine(h, c.color);
    h = hashCombine(h, c.rhythmBpm);
  }
  h = hashCombine(h, data.traffic.length);
  for (const t of data.traffic) {
    h = hashCombine(h, t.a);
    h = hashCombine(h, t.b);
    h = hashCombine(h, hashString(t.kind));
    h = hashCombine(h, t.path.length);
  }
  h = hashCombine(h, data.watchers.length);
  return h >>> 0;
}

function pathArray(path: Float32Array): number[] {
  return Array.from(path);
}

export function generateSector(req: GenerateSectorRequest): SectorData {
  const { sx, sz } = clampSectorIndex(req.sx, req.sz);
  const worldSeed = req.worldSeed | 0;
  const rng = pcg32(hash2i(sx, sz, worldSeed));
  const sampled = req.maps.at(sx, sz);
  const density = sampled.density;
  const region = sampled.region;
  const origin = sectorOrigin(sx, sz);
  const kinds = REGION_KINDS[region];
  const hues = REGION_HUES[region];
  const nClusters = rng.poisson(density * 4);

  const constructs: ConstructInstance[] = [];
  const clusters: ClusterRecord[] = [];
  const margin = MAJOR_GRID * 2;

  for (let c = 0; c < nClusters; c++) {
    const cx = snapToGrid(origin.x + rng.float(margin, SECTOR_SIZE - margin), MAJOR_GRID);
    const cz = snapToGrid(origin.z + rng.float(margin, SECTOR_SIZE - margin), MAJOR_GRID);
    const size = rng.int(2, 20);
    const start = constructs.length;
    for (let i = 0; i < size; i++) {
      const kind = rng.pick(kinds);
      const spec = sampleMinorSpec(kind, rng);
      const ext = specExtent(spec);
      const spread = 40 + size * 6;
      const ox = snapToGrid(rng.float(-spread, spread), MINOR_GRID);
      const oz = snapToGrid(rng.float(-spread, spread), MINOR_GRID);
      const y = heightFor(rng, region, density);
      const x = snapToGrid(cx + ox, MINOR_GRID);
      const z = snapToGrid(cz + oz, MINOR_GRID);
      const seed = rng.nextU32();
      const color = rng.pick(hues);
      const rhythmBpm = rng.pick(TEMPO_SET);
      const importance = importanceOf(kind, y);
      constructs.push({
        id: `${sx}:${sz}:${constructs.length}`,
        sx,
        sz,
        x,
        y: y + ext.h * 0.5,
        z,
        kind,
        spec,
        color,
        intensity: 0.85 + density * 0.4,
        importance,
        rhythmBpm,
        seed,
      });
    }
    clusters.push({ x: cx, z: cz, count: constructs.length - start });
  }

  const traffic: SectorTraffic[] = [];
  const addEdge = (
    a: number,
    b: number,
    kind: SectorTraffic['kind'],
    ay = constructs[a]!.y,
    by = constructs[b]!.y,
  ): void => {
    const A = constructs[a]!;
    const B = constructs[b]!;
    traffic.push({
      a,
      b,
      kind,
      path: pathArray(manhattanRoute(A.x, ay, A.z, B.x, by, B.z)),
    });
  };

  let cursor = 0;
  for (const cl of clusters) {
    const pts = constructs.slice(cursor, cursor + cl.count).map((p) => ({ x: p.x, z: p.z }));
    const { mst, extra } = clusterLinks(pts, (n) => rng.below(n), EXTRA_EDGE_RATIO);
    for (const [i, j] of mst) addEdge(cursor + i, cursor + j, 'cluster');
    for (const [i, j] of extra) addEdge(cursor + i, cursor + j, 'extra');
    const lm = nearestLandmark(req.landmarks, cl.x, cl.z);
    if (lm && cl.count > 0) {
      const p = landmarkWorld(lm);
      const from = constructs[cursor]!;
      traffic.push({
        a: cursor,
        b: cursor,
        kind: 'trunk',
        path: pathArray(routeToward(from.x, from.y, from.z, p.x, p.y, p.z, TRUNK_LENGTH)),
      });
    }
    cursor += cl.count;
  }

  const watchers: WatcherInstance[] = [];
  if (constructs.length > 0) {
    let hi = 0;
    for (let i = 1; i < constructs.length; i++) {
      if (constructs[i]!.importance > constructs[hi]!.importance) hi = i;
    }
    const target = constructs[hi]!;
    if (region === 'EURO' || target.importance > 3) {
      watchers.push({
        x: target.x + MAJOR_GRID,
        y: target.y + 24,
        z: target.z,
        kind: 'turing',
      });
    }
    if (density > 0.55 && rng.chance(0.35)) {
      const t = rng.pick(constructs);
      watchers.push({ x: t.x, y: t.y + 40, z: t.z + MAJOR_GRID, kind: 'sysop' });
    }
  }

  const data: SectorData = {
    sx,
    sz,
    worldSeed,
    region,
    density,
    constructs,
    clusters,
    traffic,
    watchers,
    contentHash: 0,
  };
  data.contentHash = hashData(data);
  return data;
}

export { MINOR_GRAMMARS };
