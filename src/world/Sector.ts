/**
 * Per-sector procedural population (plan §8.6). Pure function of
 * `(sx, sz, worldSeed, density, region)`. Does not import construct emitters.
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
import type { RegionCode } from './densityMap';
import { landmarkWorld, nearestLandmark, type LandmarkDef } from './landmarks';
import { clusterLinks, manhattanRoute, routeToward } from './traffic/routing';
import type { PrimitiveKind, PrimitiveSpec } from './constructs/grammar';

export const DEFAULT_WORLD_SEED = 1;
export const TEMPO_SET = [48, 72, 96, 120] as const;
export const TRUNK_LENGTH = 512;
export const EXTRA_EDGE_RATIO = 0.2;

const HUE = { GRID: 0, MITSU: 2, TA: 3, ESFA: 4, AMBER: 5, ICE: 6, MIL: 7 } as const;

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

/** Compact grammar-valid defaults; random ranges live in `sampleSpec.ts` (tests). */
function specFor(kind: PrimitiveKind): PrimitiveSpec {
  switch (kind) {
    case 'box':
      return { kind, w: 8, h: 12, d: 8, subdivisions: 1, hatch: true };
    case 'slabTerrace':
      return { kind, count: 5, spacing: 2, w: 20, h: 2, d: 8, symmetry: true };
    case 'cubeStack':
      return { kind, n: 3, m: 3, k: 4, gap: 0.2 };
    case 'ziggurat':
      return { kind, steps: 6, base: 24, stepH: 3, inset: 1.6 };
    case 'mast':
      return { kind, height: 32, sections: 5, dishes: 2 };
    case 'nestedPoly':
      return { kind, solid: 'octa', shells: 3, rotationAxes: [0, 1, 2], radius: 8 };
    case 'geodesic':
      return { kind, frequency: 2, radius: 10 };
    case 'tower':
      return { kind, sides: 6, height: 24, taper: 0.4, rings: 5 };
    case 'constellation':
      return { kind, n: 32, distribution: 'cluster' };
    default:
      return { kind: 'box', w: 8, h: 12, d: 8, subdivisions: 1, hatch: true };
  }
}

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
  /** Patrol phase at t = 0 (radians, 0 = +Z). */
  yaw0: number;
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
  contentHash: number;
}

export interface GenerateSectorRequest {
  sx: number;
  sz: number;
  worldSeed: number;
  density: number;
  region: RegionCode;
  landmarks: readonly LandmarkDef[];
}

function heightFor(rng: Pcg32, region: RegionCode, density: number): number {
  if (region === 'ORBT') return snapToGrid(rng.float(2000, 8000), MINOR_GRID);
  const roll = rng.next();
  if (roll < 0.08 + density * 0.04) return snapToGrid(rng.float(2000, 6000), MINOR_GRID);
  if (roll < 0.35 + density * 0.15) return snapToGrid(rng.float(200, 2000), MINOR_GRID);
  return snapToGrid(rng.float(16, 200), MINOR_GRID);
}

/**
 * Watchers near high-value constructs (plan §8.6). Kept local so the sector
 * worker never imports `watchers/Watcher.ts` (Three / BeamBatch).
 * Keep rules aligned with `placeWatchers` in that module.
 */
function placeWatchers(
  rng: Pcg32,
  constructs: ConstructInstance[],
  region: RegionCode,
  density: number,
): WatcherInstance[] {
  if (region === 'VOID' || constructs.length === 0) return [];
  const valuable: ConstructInstance[] = [];
  for (const c of constructs) {
    if (c.importance >= 0.2 || c.kind === 'geodesic' || c.kind === 'nestedPoly') {
      valuable.push(c);
    }
  }
  const pool = valuable.length > 0 ? valuable : constructs;
  const turingLand = region === 'EURO' || region === 'ORBT';
  const mean = (turingLand ? 1.1 : 0.55) * Math.max(density, 0.12);
  let n = rng.poisson(mean);
  if (density > 0.45 && n === 0) n = 1;
  n = Math.min(n, 4, pool.length);
  const used = new Uint8Array(pool.length);
  const out: WatcherInstance[] = [];
  for (let i = 0; i < n; i++) {
    let idx = rng.below(pool.length);
    let guard = 0;
    while (used[idx] && guard < pool.length) {
      idx = (idx + 1) % pool.length;
      guard++;
    }
    used[idx] = 1;
    const c = pool[idx]!;
    const turingRoll = rng.next();
    const kind: WatcherInstance['kind'] = turingLand
      ? turingRoll < 0.8
        ? 'turing'
        : 'sysop'
      : turingRoll < 0.25
        ? 'turing'
        : 'sysop';
    out.push({
      x: snapToGrid(c.x + rng.float(-32, 32), MINOR_GRID),
      y: c.y + 12,
      z: snapToGrid(c.z + rng.float(-32, 32), MINOR_GRID),
      kind,
      yaw0: rng.float(0, Math.PI * 2),
    });
  }
  return out;
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
  }
  h = hashCombine(h, data.traffic.length);
  for (const t of data.traffic) {
    h = hashCombine(h, t.path.length);
  }
  h = hashCombine(h, data.watchers.length);
  for (const w of data.watchers) {
    h = hashCombine(h, w.x);
    h = hashCombine(h, w.y);
    h = hashCombine(h, w.z);
    h = hashCombine(h, hashString(w.kind));
    h = hashCombine(h, Math.round(w.yaw0 * 1000));
  }
  return h >>> 0;
}

export function generateSector(req: GenerateSectorRequest): SectorData {
  const { sx, sz } = clampSectorIndex(req.sx, req.sz);
  const worldSeed = req.worldSeed | 0;
  const rng = pcg32(hash2i(sx, sz, worldSeed));
  const { density, region } = req;
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
      const spec = specFor(kind);
      const spread = 40 + size * 6;
      const ox = snapToGrid(rng.float(-spread, spread), MINOR_GRID);
      const oz = snapToGrid(rng.float(-spread, spread), MINOR_GRID);
      const y = heightFor(rng, region, density);
      const x = snapToGrid(cx + ox, MINOR_GRID);
      const z = snapToGrid(cz + oz, MINOR_GRID);
      constructs.push({
        id: `${sx}:${sz}:${constructs.length}`,
        sx,
        sz,
        x,
        y: y + 8,
        z,
        kind,
        spec,
        color: rng.pick(hues),
        intensity: 0.85 + density * 0.4,
        importance: y / 1000,
        rhythmBpm: rng.pick(TEMPO_SET),
        seed: rng.nextU32(),
      });
    }
    clusters.push({ x: cx, z: cz, count: constructs.length - start });
  }

  const traffic: SectorTraffic[] = [];
  const addEdge = (a: number, b: number, kind: SectorTraffic['kind']): void => {
    const A = constructs[a]!;
    const B = constructs[b]!;
    traffic.push({
      a,
      b,
      kind,
      path: Array.from(manhattanRoute(A.x, A.y, A.z, B.x, B.y, B.z)),
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
        path: Array.from(routeToward(from.x, from.y, from.z, p.x, p.y, p.z, TRUNK_LENGTH)),
      });
    }
    cursor += cl.count;
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
    watchers: placeWatchers(rng, constructs, region, density),
    contentHash: 0,
  };
  data.contentHash = hashData(data);
  return data;
}
