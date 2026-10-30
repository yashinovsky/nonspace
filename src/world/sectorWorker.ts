/**
 * Web Worker entry for sector generation (plan §8.6). Spec-only: no Three,
 * no BeamBatch, no construct emitters, no density rasters.
 */

import type { RegionCode } from './densityMap';
import type { LandmarkDef } from './landmarks';
import { generateSector, type SectorData } from './Sector';

export type WorkerRequest =
  | { type: 'init'; landmarks: LandmarkDef[] }
  | {
      type: 'gen';
      id: number;
      sx: number;
      sz: number;
      worldSeed: number;
      density: number;
      region: RegionCode;
    };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'data'; id: number; sector: SectorData }
  | { type: 'error'; id?: number; message: string };

type WorkerScope = {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

const ctx = self as unknown as WorkerScope;
let landmarks: LandmarkDef[] = [];
let ready = false;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      landmarks = msg.landmarks;
      ready = true;
      ctx.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'gen') {
      if (!ready) {
        ctx.postMessage({ type: 'error', id: msg.id, message: 'worker not init' });
        return;
      }
      const sector = generateSector({
        sx: msg.sx,
        sz: msg.sz,
        worldSeed: msg.worldSeed,
        density: msg.density,
        region: msg.region,
        landmarks,
      });
      ctx.postMessage({ type: 'data', id: msg.id, sector });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message });
  }
};
