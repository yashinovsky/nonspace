/**
 * Dev route `?lab=sector` (M2.3). Fly the streamed 5×5 window; landmarks stay
 * as far points from every sector. Query: `?lab=sector&seed=1&autofly=1`.
 *
 * Generation uses `createAsyncBackend` so `generateSector` shares rng/hash
 * with the App graph. `sectorWorker.ts` is the module-worker implementation
 * (kept off the lab import graph so dist stays under 1 MB).
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type Scene,
} from 'three';
import type { CameraRig } from '../player/CameraRig';
import type { FlightController } from '../player/FlightController';
import { BEAM_HEX } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import {
  formatMatrixCoord,
  sectorCenter,
  STREAM_RADIUS,
  worldToMatrixCoord,
  worldToSector,
} from './coords';
import { sampleAuthored, type RegionCode } from './densityMap';
import { landmarkWorld, resolveLandmarks, type LandmarkDef } from './landmarks';
import { generateSector, type SectorData } from './Sector';
import { createAsyncBackend, createSectorStreamer, type SectorStreamer } from './SectorStreamer';
import { isAxisAligned, isOnGridLines } from './traffic/routing';

export interface SectorLab {
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface SectorLabOptions {
  renderer: Renderer;
  flight: FlightController;
  cameraRig: CameraRig;
  root: HTMLElement;
  seed?: string | null;
  autofly?: boolean;
  landmarks?: readonly LandmarkDef[];
}

export interface SectorLabHandle {
  loaded: number;
  pending: number;
  region: RegionCode | string;
  coord: string;
  landmarkCount: number;
  hashes: Record<string, number>;
  stats: SectorStreamer['stats'];
  trafficManhattan: boolean;
  jumpTo(sx: number, sz: number, y?: number): void;
  setAutofly(on: boolean): void;
  currentHash(): number | null;
  /** Drive streaming without rAF so e2e can freeze SwiftShader. */
  update(dt: number): void;
}

declare global {
  interface Window {
    __nonspaceSector?: SectorLabHandle;
  }
}

function rgb(beam: number): [number, number, number] {
  const h = BEAM_HEX[(beam | 0) & 7] ?? 0xa8d8ff;
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

function makeLines(pos: number[], colors: number[]): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(
    geo,
    new LineBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  lines.frustumCulled = false;
  return lines;
}

function makePoints(pos: number[], colors: number[], size: number): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const pts = new Points(
    geo,
    new PointsMaterial({
      size,
      vertexColors: true,
      toneMapped: false,
      sizeAttenuation: false,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

function buildSectorView(data: SectorData): LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  for (const c of data.constructs) {
    const [r, g, b] = rgb(c.color);
    const h = Math.max(8, c.spec.kind === 'mast' || c.spec.kind === 'tower' ? 24 : 12);
    pos.push(c.x, c.y - h, c.z, c.x, c.y + h, c.z);
    col.push(r, g, b, r, g, b);
  }
  for (const t of data.traffic) {
    const [r, g, b] = rgb(t.kind === 'trunk' ? 5 : 0);
    const p = t.path;
    for (let i = 3; i < p.length; i += 3) {
      pos.push(p[i - 3]!, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!, p[i + 2]!);
      col.push(r, g, b, r, g, b);
    }
  }
  if (pos.length === 0) {
    pos.push(0, 0, 0, 0, 0, 0);
    col.push(0, 0, 0, 0, 0, 0);
  }
  return makeLines(pos, col);
}

function landmarkPoints(landmarks: readonly LandmarkDef[]): Points {
  const pos: number[] = [];
  const col: number[] = [];
  for (const lm of landmarks) {
    const p = landmarkWorld(lm);
    pos.push(p.x, p.y, p.z);
    const [r, g, b] = rgb(lm.color);
    col.push(r, g, b);
  }
  return makePoints(pos, col, 8);
}

function trafficManhattan(streamer: SectorStreamer): boolean {
  for (const key of streamer.loadedKeys()) {
    const [sx, sz] = key.split(':').map(Number);
    const data = streamer.get(sx!, sz!);
    if (!data) continue;
    for (const t of data.traffic) {
      if (!isAxisAligned(t.path) || !isOnGridLines(t.path)) return false;
    }
  }
  return true;
}

export async function installSectorLab(opts: SectorLabOptions): Promise<SectorLab> {
  const { renderer, flight, cameraRig, root } = opts;
  const landmarks = resolveLandmarks(opts.landmarks);
  const worldSeed = opts.seed != null && opts.seed !== '' ? Number(opts.seed) | 0 : 1;
  let autofly = Boolean(opts.autofly);
  const scene: Scene = renderer.scenes.matrix;
  scene.background = new Color(0x000000);

  const lmPts = landmarkPoints(landmarks);
  scene.add(lmPts);
  const views = new Map<string, LineSegments>();

  const streamer = createSectorStreamer({
    backend: createAsyncBackend((sx, sz, seed) => {
      const at = sampleAuthored(sx, sz);
      return generateSector({
        sx,
        sz,
        worldSeed: seed,
        density: at.density,
        region: at.region,
        landmarks,
      });
    }),
    worldSeed,
    landmarks,
    createView: () => ({ group: null as LineSegments | null }),
    buildSlice: (data, raw) => {
      const t0 = performance.now();
      const view = raw as { group: LineSegments | null };
      if (view.group) return { done: true, costMs: 0 };
      const lines = buildSectorView(data);
      const key = `${data.sx}:${data.sz}`;
      const prev = views.get(key);
      if (prev) {
        scene.remove(prev);
        prev.geometry.dispose();
        (prev.material as LineBasicMaterial).dispose();
      }
      scene.add(lines);
      views.set(key, lines);
      view.group = lines;
      return { done: true, costMs: Math.max(0, performance.now() - t0) };
    },
  });

  const start = sectorCenter(148, 72);
  flight.setPose({
    x: start.x,
    y: 120,
    z: start.z,
    yaw: Math.PI / 2,
    pitch: -0.12,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  streamer.update(start.x, 120, start.z);

  const overlay = document.createElement('div');
  overlay.dataset.testid = 'sector-lab';
  overlay.style.cssText =
    'position:fixed;inset:0;pointer-events:none;font:13px/1.4 ui-monospace,Menlo,monospace;color:#a8d8ff;z-index:20';
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;left:1rem;top:1rem;min-width:18rem;background:rgba(0,0,0,0.55);padding:0.75rem 0.9rem;border:1px solid #1a3348';
  overlay.appendChild(panel);
  root.appendChild(overlay);
  const title = document.createElement('div');
  title.style.cssText = 'letter-spacing:0.22em;color:#ffb000;margin:0 0 0.45rem;font-size:11px';
  title.textContent = 'SECTOR  ·  M2.3';
  panel.appendChild(title);
  const readout = document.createElement('pre');
  readout.dataset.testid = 'sector-readout';
  readout.style.cssText = 'margin:0;color:#c8e4ff;font:12px/1.45 inherit;white-space:pre';
  panel.appendChild(readout);

  const here = (): { sx: number; sz: number; at: ReturnType<typeof sampleAuthored> } => {
    const { sx, sz } = worldToSector(flight.pose.x, flight.pose.z);
    return { sx, sz, at: sampleAuthored(sx, sz) };
  };

  const tick = (dt: number): void => {
    if (autofly) {
      const p = flight.pose;
      flight.setPose({
        x: p.x + 600 * dt,
        y: p.y,
        z: p.z,
        yaw: Math.PI / 2,
        vx: 600,
        vy: 0,
        vz: 0,
      });
    }
    const p = flight.pose;
    streamer.update(p.x, p.y, p.z, dt);
    const keep = new Set(streamer.loadedKeys());
    for (const [key, obj] of views) {
      if (!keep.has(key)) {
        scene.remove(obj);
        obj.geometry.dispose();
        (obj.material as LineBasicMaterial).dispose();
        views.delete(key);
      }
    }
    const { sx, sz, at } = here();
    root.dataset.loaded = String(streamer.stats.loaded);
    root.dataset.region = at.region;
    root.dataset.hash = String(streamer.get(sx, sz)?.contentHash ?? '');
  };

  const handle: SectorLabHandle = {
    get loaded() {
      return streamer.stats.loaded;
    },
    get pending() {
      return streamer.stats.pending;
    },
    get region() {
      return here().at.region;
    },
    get coord() {
      const { at } = here();
      const p = flight.pose;
      return formatMatrixCoord(worldToMatrixCoord(p.x, p.y, p.z, at.region));
    },
    landmarkCount: landmarks.length,
    get hashes() {
      return streamer.hashes();
    },
    get stats() {
      return streamer.stats;
    },
    get trafficManhattan() {
      return trafficManhattan(streamer);
    },
    jumpTo(sx, sz, y = 120) {
      const c = sectorCenter(sx, sz);
      flight.setPose({ x: c.x, y, z: c.z, vx: 0, vy: 0, vz: 0 });
      streamer.update(c.x, y, c.z);
    },
    setAutofly(on) {
      autofly = on;
    },
    currentHash() {
      const { sx, sz } = here();
      return streamer.get(sx, sz)?.contentHash ?? null;
    },
    update(dt) {
      tick(dt);
    },
  };
  window.__nonspaceSector = handle;
  root.dataset.lab = 'sector';
  root.dataset.landmarks = String(landmarks.length);
  root.dataset.streamRadius = String(STREAM_RADIUS);

  const lab: SectorLab = {
    update: tick,
    render(alpha) {
      cameraRig.apply(flight, alpha);
      const t = flight.telemetry;
      const s = streamer.stats;
      readout.textContent = [
        `coord     ${handle.coord}`,
        `region    ${handle.region}`,
        `loaded    ${s.loaded}  pending ${s.pending}  inflight ${s.inFlight}`,
        `main ms   ${s.lastMainMs.toFixed(2)}  max ${s.maxMainMs.toFixed(2)}`,
        `upload    ${s.lastUploadMs.toFixed(2)}  hitches>4ms ${s.hitchesOver4ms}`,
        `speed     ${t.speed.toFixed(1)} u/s  alt ${t.altitude.toFixed(0)}`,
        `landmarks ${landmarks.length}  manhattan ${handle.trafficManhattan ? 'yes' : 'NO'}`,
        `autofly   ${autofly ? 'ON' : 'off'}`,
      ].join('\n');
    },
    dispose() {
      overlay.remove();
      streamer.dispose();
      scene.remove(lmPts);
      lmPts.geometry.dispose();
      (lmPts.material as PointsMaterial).dispose();
      for (const obj of views.values()) {
        scene.remove(obj);
        obj.geometry.dispose();
        (obj.material as LineBasicMaterial).dispose();
      }
      views.clear();
      if (window.__nonspaceSector === handle) delete window.__nonspaceSector;
    },
  };
  return lab;
}
