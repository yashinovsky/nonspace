import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { generate } from '../../src/world/constructs/grammar';
import {
  formatMatrixCoord,
  MAJOR_GRID,
  parseMatrixCoord,
  SECTOR_SIZE,
  sectorKey,
  snapToGrid,
  STREAM_RADIUS,
  worldToSector,
} from '../../src/world/coords';
import {
  createAuthoredMaps,
  DENSITY_HEIGHT,
  DENSITY_WIDTH,
  mapsFromRgba,
  REGION_CODES,
  sampleAuthored,
} from '../../src/world/densityMap';
import { FALLBACK_LANDMARKS, landmarkWorld } from '../../src/world/landmarks';
import { DEFAULT_WORLD_SEED, generateSector } from '../../src/world/Sector';
import { sampleMinorSpec } from '../../src/world/sampleSpec';
import {
  createDeferredBackend,
  createSectorStreamer,
  HITCH_LIMIT_MS,
  neededSectors,
} from '../../src/world/SectorStreamer';
import {
  isAxisAligned,
  isOnGridLines,
  manhattanRoute,
  polylineLength,
} from '../../src/world/traffic/routing';
import { pcg32 } from '../../src/core/rng';

const here = dirname(fileURLToPath(import.meta.url));
const maps = createAuthoredMaps();

function gen(sx: number, sz: number, seed = DEFAULT_WORLD_SEED) {
  const at = maps.at(sx, sz);
  return generateSector({
    sx,
    sz,
    worldSeed: seed,
    density: at.density,
    region: at.region,
    landmarks: FALLBACK_LANDMARKS,
  });
}

describe('coords', () => {
  it('formats and parses deck addresses as region + sector.fraction', () => {
    const text = formatMatrixCoord({ region: 'BAMA', x: 148.5, z: 72.5, y: 120 });
    expect(text).toBe('BAMA 0148.50 / 0072.50 / 0120');
    expect(parseMatrixCoord(text)).toEqual({ region: 'BAMA', x: 148.5, z: 72.5, y: 120 });
    expect(parseMatrixCoord('not a coord')).toBeNull();
  });

  it('maps world XZ to clamped sector indices', () => {
    expect(worldToSector(148 * SECTOR_SIZE + 10, 72 * SECTOR_SIZE + 20)).toEqual({
      sx: 148,
      sz: 72,
    });
    expect(worldToSector(-50, 9e9)).toEqual({ sx: 0, sz: 255 });
    expect(snapToGrid(70, 64)).toBe(64);
  });
});

describe('density / region maps', () => {
  it('committed PNGs match the authored blob function', () => {
    const dir = resolve(here, '../fixtures');
    const dPng = PNG.sync.read(readFileSync(resolve(dir, 'density.png')));
    const rPng = PNG.sync.read(readFileSync(resolve(dir, 'regions.png')));
    expect(dPng.width).toBe(DENSITY_WIDTH);
    expect(dPng.height).toBe(DENSITY_HEIGHT);
    const fromFiles = mapsFromRgba(dPng.data, rPng.data, dPng.width, dPng.height);
    expect(Array.from(fromFiles.density)).toEqual(Array.from(maps.density));
    expect(Array.from(fromFiles.region)).toEqual(Array.from(maps.region));
  });

  it('has bright BAMA / CHBA / EURO / RIO blobs and an orbital band, no empty palette', () => {
    expect(maps.sample(148, 72)).toBeGreaterThan(0.7);
    expect(maps.regionCode(148, 72)).toBe('BAMA');
    expect(maps.regionCode(448, 76)).toBe('CHBA');
    expect(maps.regionCode(268, 56)).toBe('EURO');
    expect(maps.regionCode(196, 168)).toBe('RIO');
    expect(maps.regionCode(40, 8)).toBe('ORBT');
    expect(maps.regionCode(20, 200)).toBe('VOID');
    expect(REGION_CODES).toContain('BAMA');
    const spot = sampleAuthored(148, 72);
    expect(spot.region).toBe('BAMA');
    expect(spot.density).toBe(maps.sample(148, 72));
  });
});

describe('manhattan routing', () => {
  it('routes X then Z then Y on the 64 u grid', () => {
    const path = manhattanRoute(10, 5, 10, 200, 40, 130);
    expect(isAxisAligned(path)).toBe(true);
    expect(isOnGridLines(path, MAJOR_GRID)).toBe(true);
    expect(path[0]).toBe(0);
    expect(path[2]).toBe(0);
    expect(polylineLength(path)).toBeGreaterThan(0);
    const midY = path[4];
    expect(midY).toBe(5);
  });
});

describe('generateSector', () => {
  it('is a pure function of (sx, sz, worldSeed) — returning reproduces content', () => {
    const a = gen(148, 72, 1);
    const b = gen(148, 72, 1);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.constructs.length).toBe(b.constructs.length);
    expect(a.constructs.map((c) => [c.x, c.y, c.z, c.kind])).toEqual(
      b.constructs.map((c) => [c.x, c.y, c.z, c.kind]),
    );
    expect(gen(148, 72, 2).contentHash).not.toBe(a.contentHash);
    expect(gen(149, 72, 1).contentHash).not.toBe(a.contentHash);
  });

  it('pins a golden hash for BAMA 148,72 seed 1', () => {
    expect(gen(148, 72, 1).contentHash).toBe(4291881016);
  });

  it('snaps cluster centers to the 64 u grid and emits Manhattan traffic', () => {
    const s = gen(148, 72, 1);
    expect(s.region).toBe('BAMA');
    expect(s.clusters.length).toBeGreaterThan(0);
    for (const cl of s.clusters) {
      expect(cl.x).toBe(snapToGrid(cl.x, MAJOR_GRID));
      expect(cl.z).toBe(snapToGrid(cl.z, MAJOR_GRID));
    }
    expect(s.traffic.length).toBeGreaterThan(0);
    for (const t of s.traffic) {
      expect(isAxisAligned(t.path)).toBe(true);
      expect(isOnGridLines(t.path)).toBe(true);
    }
  });

  it('produces grammar-compatible specs (M2.1 generate accepts them)', () => {
    const s = gen(148, 72, 1);
    expect(s.constructs.length).toBeGreaterThan(0);
    for (const c of s.constructs.slice(0, 8)) {
      const geom = generate(c.spec, { lod: 'mid', seed: c.seed });
      expect(geom.stats.segments).toBeGreaterThanOrEqual(0);
      expect(geom.stats.points).toBeGreaterThanOrEqual(0);
    }
    const spec = sampleMinorSpec('ziggurat', pcg32(9));
    expect(spec.kind).toBe('ziggurat');
  });
});

describe('SectorStreamer', () => {
  it('keeps a 5×5 window, landmarks always listed, and identical hashes on return', async () => {
    const backend = createDeferredBackend((sx, sz, seed) => gen(sx, sz, seed));
    const streamer = createSectorStreamer({ backend, worldSeed: 1, landmarks: FALLBACK_LANDMARKS });
    const start = landmarkWorld(FALLBACK_LANDMARKS[2]!); // mitsubishi-boa in BAMA
    streamer.update(start.x, start.y, start.z);
    for (let i = 0; i < 40; i++) {
      backend.flush(8);
      await Promise.resolve();
      streamer.update(start.x, start.y, start.z);
    }
    expect(neededSectors(148, 72).length).toBe((STREAM_RADIUS * 2 + 1) ** 2);
    expect(streamer.stats.loaded).toBe(25);
    expect(streamer.landmarks.length).toBe(FALLBACK_LANDMARKS.length);
    const hash = streamer.get(148, 72)?.contentHash;
    expect(hash).toBe(gen(148, 72, 1).contentHash);
    const far = { x: start.x + SECTOR_SIZE * 12, y: 120, z: start.z };
    streamer.update(far.x, far.y, far.z);
    for (let i = 0; i < 50; i++) {
      backend.flush(8);
      await Promise.resolve();
      streamer.update(far.x, far.y, far.z);
    }
    expect(streamer.get(148, 72)).toBeUndefined();
    streamer.update(start.x, start.y, start.z);
    for (let i = 0; i < 40; i++) {
      backend.flush(8);
      await Promise.resolve();
      streamer.update(start.x, start.y, start.z);
    }
    expect(streamer.get(148, 72)?.contentHash).toBe(hash);
    expect(streamer.landmarks).toHaveLength(FALLBACK_LANDMARKS.length);
    streamer.dispose();
  });

  it('budgeted upload never reports a >4 ms hitch (2 min boost, deferred gen)', async () => {
    const backend = createDeferredBackend((sx, sz, seed) => gen(sx, sz, seed));
    let sliceCalls = 0;
    const streamer = createSectorStreamer({
      backend,
      worldSeed: 1,
      uploadBudgetMs: 1,
      hitchLimitMs: HITCH_LIMIT_MS,
      createView: () => ({ n: 0 }),
      buildSlice: (_data, view) => {
        const v = view as { n: number };
        v.n += 1;
        sliceCalls++;
        return { done: v.n >= 3, costMs: 0.4 };
      },
    });
    const startX = 148 * SECTOR_SIZE;
    const z = 72 * SECTOR_SIZE + 512;
    const dt = 1 / 60;
    const speed = 600;
    const frames = 120 * 60;
    let x = startX;
    for (let i = 0; i < frames; i++) {
      x += speed * dt;
      streamer.update(x, 120, z);
      backend.flush(2);
      await Promise.resolve();
      streamer.update(x, 120, z);
    }
    expect(x).toBeCloseTo(startX + 600 * 120, 0);
    expect(sectorKey(worldToSector(x, z).sx, worldToSector(x, z).sz)).toMatch(/^\d+:\d+$/);
    expect(streamer.stats.maxUploadMs).toBeLessThanOrEqual(HITCH_LIMIT_MS);
    expect(streamer.stats.hitchesOver4ms).toBe(0);
    expect(streamer.stats.generated).toBeGreaterThan(50);
    expect(sliceCalls).toBeGreaterThan(50);
    expect(streamer.landmarks.length).toBeGreaterThan(0);
    streamer.dispose();
  });
});
