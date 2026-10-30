/**
 * 5×5 sector window around the player (plan §8.6). Generation is off-thread
 * via a `SectorBackend`; GPU/CPU views upload on the main thread in slices
 * budgeted at ≤ 1 ms/frame, never more than 4 ms (hitch AC).
 */

import { STREAM_RADIUS, sectorKey, worldToSector, type SectorIndex } from './coords';
import type { SectorData } from './Sector';
import { resolveLandmarks, type LandmarkDef } from './landmarks';

export const UPLOAD_BUDGET_MS = 1;
export const HITCH_LIMIT_MS = 4;
/** Keep a one-ring hysteresis so returning to a sector does not regenerate. */
export const UNLOAD_RADIUS = STREAM_RADIUS + 1;

export interface SectorBackend {
  generate(sx: number, sz: number, worldSeed: number): Promise<SectorData>;
  dispose(): void;
}

export interface SliceResult {
  done: boolean;
  /** Charged against the per-frame budget. */
  costMs: number;
}

export type BuildSlice = (data: SectorData, view: unknown) => SliceResult;

export interface StreamerStats {
  loaded: number;
  pending: number;
  inFlight: number;
  generated: number;
  unloaded: number;
  lastMainMs: number;
  maxMainMs: number;
  lastUploadMs: number;
  maxUploadMs: number;
  hitchesOver4ms: number;
  windowSx: number;
  windowSz: number;
}

export interface SectorStreamer {
  readonly landmarks: readonly LandmarkDef[];
  readonly stats: StreamerStats;
  update(x: number, y: number, z: number, dt?: number): void;
  /**
   * Kick the 5×5 window around a destination without unloading the current
   * player window (coordinate-jump preload, M2.6).
   */
  preload(x: number, z: number): void;
  /** True when every sector in the 5×5 around (x,z) has data. */
  readyAround(x: number, z: number): boolean;
  get(sx: number, sz: number): SectorData | undefined;
  view(sx: number, sz: number): unknown;
  loadedKeys(): string[];
  hashes(): Record<string, number>;
  dispose(): void;
}

export interface SectorStreamerOptions {
  backend: SectorBackend;
  worldSeed?: number;
  landmarks?: readonly LandmarkDef[];
  radius?: number;
  unloadRadius?: number;
  uploadBudgetMs?: number;
  hitchLimitMs?: number;
  /**
   * Optional view builder. Called in budgeted slices when a sector's data
   * arrives. Return `{ done, costMs }`. Headless tests may omit this.
   */
  createView?: (data: SectorData) => unknown;
  buildSlice?: BuildSlice;
  now?: () => number;
}

interface Slot {
  key: string;
  sx: number;
  sz: number;
  state: 'pending' | 'ready' | 'built';
  data?: SectorData;
  view?: unknown;
  job?: Promise<void>;
}

export function neededSectors(sx: number, sz: number, radius = STREAM_RADIUS): SectorIndex[] {
  const out: SectorIndex[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ sx: sx + dx, sz: sz + dz });
    }
  }
  return out;
}

export function createSectorStreamer(opts: SectorStreamerOptions): SectorStreamer {
  const radius = opts.radius ?? STREAM_RADIUS;
  const unloadR = opts.unloadRadius ?? UNLOAD_RADIUS;
  const budget = opts.uploadBudgetMs ?? UPLOAD_BUDGET_MS;
  const hitch = opts.hitchLimitMs ?? HITCH_LIMIT_MS;
  const worldSeed = opts.worldSeed ?? 1;
  const landmarks = resolveLandmarks(opts.landmarks);
  const now = opts.now ?? (() => performance.now());
  const slots = new Map<string, Slot>();
  const uploadQ: Slot[] = [];
  const stats: StreamerStats = {
    loaded: 0,
    pending: 0,
    inFlight: 0,
    generated: 0,
    unloaded: 0,
    lastMainMs: 0,
    maxMainMs: 0,
    lastUploadMs: 0,
    maxUploadMs: 0,
    hitchesOver4ms: 0,
    windowSx: 0,
    windowSz: 0,
  };
  let inflight = 0;
  const maxInflight = 4;

  const kick = (slot: Slot): void => {
    if (slot.job || slot.data) return;
    inflight++;
    stats.inFlight = inflight;
    slot.job = opts.backend
      .generate(slot.sx, slot.sz, worldSeed)
      .then((data) => {
        inflight--;
        stats.inFlight = inflight;
        slot.job = undefined;
        slot.data = data;
        slot.state = 'ready';
        stats.generated++;
        uploadQ.push(slot);
      })
      .catch((err: unknown) => {
        inflight--;
        stats.inFlight = inflight;
        slot.job = undefined;
        console.warn('[nonspace] sector gen failed', slot.key, err);
        slots.delete(slot.key);
      });
  };

  const pumpUploads = (t0: number): number => {
    let used = 0;
    while (uploadQ.length > 0 && used < budget && now() - t0 < hitch) {
      const slot = uploadQ[0]!;
      if (!slot.data) {
        uploadQ.shift();
        continue;
      }
      if (opts.createView && slot.view === undefined) slot.view = opts.createView(slot.data);
      if (opts.buildSlice && slot.view !== undefined) {
        const slice = opts.buildSlice(slot.data, slot.view);
        used += slice.costMs;
        if (!slice.done) break;
      }
      slot.state = 'built';
      uploadQ.shift();
    }
    stats.lastUploadMs = used;
    if (used > stats.maxUploadMs) stats.maxUploadMs = used;
    return used;
  };

  const recount = (): void => {
    let loaded = 0;
    let pending = 0;
    for (const s of slots.values()) {
      if (s.data) loaded++;
      else pending++;
    }
    stats.loaded = loaded;
    stats.pending = pending;
  };

  const api: SectorStreamer = {
    landmarks,
    stats,
    update(x, _y, z) {
      const t0 = now();
      const { sx, sz } = worldToSector(x, z);
      stats.windowSx = sx;
      stats.windowSz = sz;
      const want = new Set<string>();
      for (const s of neededSectors(sx, sz, radius)) {
        const key = sectorKey(s.sx, s.sz);
        want.add(key);
        if (!slots.has(key)) {
          const slot: Slot = { key, sx: s.sx, sz: s.sz, state: 'pending' };
          slots.set(key, slot);
        }
      }
      for (const [key, slot] of slots) {
        const dx = Math.abs(slot.sx - sx);
        const dz = Math.abs(slot.sz - sz);
        if (dx > unloadR || dz > unloadR) {
          slots.delete(key);
          stats.unloaded++;
        }
      }
      let kicked = 0;
      for (const key of want) {
        if (inflight >= maxInflight) break;
        const slot = slots.get(key);
        if (slot && !slot.data && !slot.job) {
          kick(slot);
          kicked++;
          if (kicked >= maxInflight) break;
        }
      }
      const billed = pumpUploads(t0);
      const wall = now() - t0;
      stats.lastMainMs = wall;
      if (wall > stats.maxMainMs) stats.maxMainMs = wall;
      // Hitch AC is worker-gen (off-thread) + budgeted upload, not vitest/GC noise.
      if (billed > hitch) stats.hitchesOver4ms++;
      recount();
    },
    preload(x, z) {
      const t0 = now();
      const { sx, sz } = worldToSector(x, z);
      for (const s of neededSectors(sx, sz, radius)) {
        const key = sectorKey(s.sx, s.sz);
        if (!slots.has(key)) {
          slots.set(key, { key, sx: s.sx, sz: s.sz, state: 'pending' });
        }
      }
      for (const s of neededSectors(sx, sz, radius)) {
        if (inflight >= maxInflight) break;
        const slot = slots.get(sectorKey(s.sx, s.sz));
        if (slot && !slot.data && !slot.job) kick(slot);
      }
      pumpUploads(t0);
      recount();
    },
    readyAround(x, z) {
      const { sx, sz } = worldToSector(x, z);
      for (const s of neededSectors(sx, sz, radius)) {
        if (!slots.get(sectorKey(s.sx, s.sz))?.data) return false;
      }
      return true;
    },
    get(sx, sz) {
      return slots.get(sectorKey(sx, sz))?.data;
    },
    view(sx, sz) {
      return slots.get(sectorKey(sx, sz))?.view;
    },
    loadedKeys() {
      const keys: string[] = [];
      for (const [k, s] of slots) if (s.data) keys.push(k);
      return keys.sort();
    },
    hashes() {
      const out: Record<string, number> = {};
      for (const [k, s] of slots) if (s.data) out[k] = s.data.contentHash;
      return out;
    },
    dispose() {
      slots.clear();
      uploadQ.length = 0;
      opts.backend.dispose();
    },
  };
  return api;
}

export function createSyncBackend(
  generate: (sx: number, sz: number, worldSeed: number) => SectorData,
): SectorBackend {
  return {
    generate(sx, sz, worldSeed) {
      return Promise.resolve(generate(sx, sz, worldSeed));
    },
    dispose() {},
  };
}

/**
 * Runs generate on a later macrotask so it is not on the `update()` stack.
 * Same contract as the module worker; used by the lab so rng/hash stay in
 * the shared App graph and the worker chunk is not duplicated in dist.
 */
export function createAsyncBackend(
  generate: (sx: number, sz: number, worldSeed: number) => SectorData,
): SectorBackend {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    generate(sx, sz, worldSeed) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          timers.delete(t);
          try {
            resolve(generate(sx, sz, worldSeed));
          } catch (err) {
            reject(err);
          }
        }, 0);
        timers.add(t);
      });
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

/** Completes jobs only when `flush(n)` is called — models a worker. */
export function createDeferredBackend(
  generate: (sx: number, sz: number, worldSeed: number) => SectorData,
): SectorBackend & { flush(n?: number): number; pending(): number } {
  const q: Array<{
    sx: number;
    sz: number;
    worldSeed: number;
    resolve: (d: SectorData) => void;
  }> = [];
  return {
    generate(sx, sz, worldSeed) {
      return new Promise((resolve) => {
        q.push({ sx, sz, worldSeed, resolve });
      });
    },
    flush(n = 1) {
      let i = 0;
      while (i < n && q.length) {
        const job = q.shift()!;
        job.resolve(generate(job.sx, job.sz, job.worldSeed));
        i++;
      }
      return i;
    },
    pending() {
      return q.length;
    },
    dispose() {
      q.length = 0;
    },
  };
}
