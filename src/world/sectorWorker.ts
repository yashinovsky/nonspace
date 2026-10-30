/**
 * Web Worker entry for sector generation (plan §8.6). Spec-only: no Three,
 * no BeamBatch, no construct emitters.
 */

import { mapsFromRasters, type DensityMaps } from './densityMap';
import type { LandmarkDef } from './landmarks';
import { generateSector, type SectorData } from './Sector';

export type WorkerRequest =
  | {
      type: 'init';
      density: Uint8Array;
      region: Uint8Array;
      width: number;
      height: number;
      landmarks: LandmarkDef[];
    }
  | { type: 'gen'; id: number; sx: number; sz: number; worldSeed: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'data'; id: number; sector: SectorData }
  | { type: 'error'; id?: number; message: string };

type WorkerScope = {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

const ctx = self as unknown as WorkerScope;
let maps: DensityMaps | null = null;
let landmarks: LandmarkDef[] = [];

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      maps = mapsFromRasters(msg.density, msg.region, msg.width, msg.height);
      landmarks = msg.landmarks;
      ctx.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'gen') {
      if (!maps) {
        ctx.postMessage({ type: 'error', id: msg.id, message: 'worker not init' });
        return;
      }
      const sector = generateSector({
        sx: msg.sx,
        sz: msg.sz,
        worldSeed: msg.worldSeed,
        maps,
        landmarks,
      });
      ctx.postMessage({ type: 'data', id: msg.id, sector });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message });
  }
};
