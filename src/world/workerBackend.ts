/**
 * Main-thread adapter around `sectorWorker.ts`. Imported only from the sector
 * lab so the worker chunk (and Sector.ts) stay out of the default App bundle.
 */

import type { DensityMaps } from './densityMap';
import type { LandmarkDef } from './landmarks';
import type { SectorData } from './Sector';
import type { SectorBackend } from './SectorStreamer';
import type { WorkerRequest, WorkerResponse } from './sectorWorker';

export function createWorkerBackend(
  maps: DensityMaps,
  landmarks: readonly LandmarkDef[],
): SectorBackend {
  const worker = new Worker(new URL('./sectorWorker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (d: SectorData) => void; reject: (e: Error) => void }
  >();
  let ready = false;
  const waiters: Array<() => void> = [];

  const onReady = (): void => {
    ready = true;
    for (const w of waiters) w();
    waiters.length = 0;
  };

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'ready') {
      onReady();
      return;
    }
    if (msg.type === 'data') {
      pending.get(msg.id)?.resolve(msg.sector);
      pending.delete(msg.id);
      return;
    }
    if (msg.type === 'error') {
      const err = new Error(msg.message);
      if (msg.id !== undefined) {
        pending.get(msg.id)?.reject(err);
        pending.delete(msg.id);
      }
    }
  };

  const init: WorkerRequest = {
    type: 'init',
    density: maps.density,
    region: maps.region,
    width: maps.width,
    height: maps.height,
    landmarks: landmarks.slice(),
  };
  worker.postMessage(init);

  return {
    generate(sx, sz, worldSeed) {
      return new Promise<SectorData>((resolve, reject) => {
        const start = (): void => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          const req: WorkerRequest = { type: 'gen', id, sx, sz, worldSeed };
          worker.postMessage(req);
        };
        if (ready) start();
        else waiters.push(start);
      });
    },
    dispose() {
      for (const p of pending.values()) p.reject(new Error('sector worker disposed'));
      pending.clear();
      worker.terminate();
    },
  };
}
