/**
 * Dev route `?lab=sector` (M2.3). Fly the streamed 5×5 window; landmarks stay
 * as far points from every sector. Query: `?lab=sector&seed=1&autofly=1`.
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
  MAJOR_GRID,
  SECTOR_SIZE,
  sectorCenter,
  STREAM_RADIUS,
  worldToMatrixCoord,
  worldToSector,
} from './coords';
import { createAuthoredMaps, mapsFromRgba, type DensityMaps, type RegionCode } from './densityMap';
import { landmarkWorld, resolveLandmarks, type LandmarkDef } from './landmarks';
import type { SectorData } from './Sector';
import { createSectorStreamer, type SectorStreamer } from './SectorStreamer';
import { isAxisAligned, isOnGridLines } from './traffic/routing';
import { createWorkerBackend } from './workerBackend';
import type { PrimitiveSpec } from './constructs/grammar';

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
  maps?: DensityMaps;
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
}

declare global {
  interface Window {
    __nonspaceSector?: SectorLabHandle;
  }
}

const CSS = [
  'position:fixed',
  'inset:0',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:20',
].join(';');

const PANEL = [
  'position:absolute',
  'pointer-events:auto',
  'left:1rem',
  'top:1rem',
  'min-width:18rem',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #1a3348',
].join(';');

function hex(i: number): number {
  return BEAM_HEX[(i | 0) & 7] ?? 0xa8d8ff;
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
    case 'nestedPoly': {
      const r = spec.radius ?? 8;
      return { w: r * 2, h: r * 2, d: r * 2 };
    }
    case 'geodesic':
      return { w: spec.radius * 2, h: spec.radius * 2, d: spec.radius * 2 };
    case 'tower':
      return { w: 10, h: spec.height, d: 10 };
    default:
      return { w: 12, h: 12, d: 12 };
  }
}

function pushBox(
  pos: number[],
  c: number[],
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
): void {
  const x0 = x - w * 0.5;
  const x1 = x + w * 0.5;
  const y0 = y - h * 0.5;
  const y1 = y + h * 0.5;
  const z0 = z - d * 0.5;
  const z1 = z + d * 0.5;
  const corners: Array<[number, number, number]> = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const edges: Array<[number, number]> = [
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
  for (const [a, b] of edges) {
    const A = corners[a]!;
    const B = corners[b]!;
    pos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
    c.push(color, color);
  }
}

function makeLines(pos: number[], colors: number[]): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mat = new LineBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    transparent: true,
    opacity: 0.9,
  });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

function rgbOf(beam: number): [number, number, number] {
  const h = hex(beam);
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

interface SectorView {
  group: LineSegments | null;
  built: number;
}

function buildConstructLines(data: SectorData): LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  for (const c of data.constructs) {
    const e = specExtent(c.spec);
    const [r, g, b] = rgbOf(c.color);
    const n0 = pos.length;
    pushBox(pos, [], c.x, c.y, c.z, e.w, e.h, e.d, 0);
    for (let i = n0; i < pos.length; i += 3) col.push(r, g, b);
  }
  for (const t of data.traffic) {
    const [r, g, b] = rgbOf(t.kind === 'trunk' ? 5 : 0);
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

function makeGrid(): LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  const half = SECTOR_SIZE * 3;
  const step = MAJOR_GRID;
  const y = 0;
  const minor = rgbOf(0);
  const major = [minor[0]! * 1.8, minor[1]! * 1.8, minor[2]! * 1.8];
  for (let i = -half; i <= half; i += step) {
    const c = i % SECTOR_SIZE === 0 ? major : minor;
    pos.push(-half, y, i, half, y, i);
    col.push(c[0]!, c[1]!, c[2]!, c[0]!, c[1]!, c[2]!);
    pos.push(i, y, -half, i, y, half);
    col.push(c[0]!, c[1]!, c[2]!, c[0]!, c[1]!, c[2]!);
  }
  const lines = makeLines(pos, col);
  lines.position.set(0, 0, 0);
  lines.frustumCulled = false;
  return lines;
}

function landmarkPoints(landmarks: readonly LandmarkDef[]): Points {
  const pos: number[] = [];
  const col: number[] = [];
  for (const lm of landmarks) {
    const p = landmarkWorld(lm);
    pos.push(p.x, p.y, p.z);
    const [r, g, b] = rgbOf(lm.color);
    col.push(r, g, b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const mat = new PointsMaterial({
    size: 6,
    vertexColors: true,
    toneMapped: false,
    sizeAttenuation: false,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'landmarks';
  return pts;
}

async function loadMaps(): Promise<DensityMaps> {
  try {
    const [dRes, rRes] = await Promise.all([
      fetch('/data/density.png'),
      fetch('/data/regions.png'),
    ]);
    if (!dRes.ok || !rRes.ok) return createAuthoredMaps();
    const [dBlob, rBlob] = await Promise.all([dRes.blob(), rRes.blob()]);
    const [dBmp, rBmp] = await Promise.all([createImageBitmap(dBlob), createImageBitmap(rBlob)]);
    const canvas = document.createElement('canvas');
    canvas.width = dBmp.width;
    canvas.height = dBmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(dBmp, 0, 0);
    const dPix = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rBmp, 0, 0);
    const rPix = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return mapsFromRgba(Uint8Array.from(dPix), Uint8Array.from(rPix), canvas.width, canvas.height);
  } catch {
    return createAuthoredMaps();
  }
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
  const maps = opts.maps ?? (await loadMaps());
  const landmarks = resolveLandmarks(opts.landmarks);
  const worldSeed = opts.seed != null && opts.seed !== '' ? Number(opts.seed) | 0 : 1;
  let autofly = Boolean(opts.autofly);
  const scene: Scene = renderer.scenes.matrix;
  scene.background = new Color(0x000000);

  const grid = makeGrid();
  scene.add(grid);
  const lmPts = landmarkPoints(landmarks);
  scene.add(lmPts);

  const views = new Map<string, LineSegments>();

  const streamer = createSectorStreamer({
    backend: createWorkerBackend(maps, landmarks),
    worldSeed,
    landmarks,
    createView: (data) => {
      const view: SectorView = { group: null, built: 0 };
      void data;
      return view;
    },
    buildSlice: (data, raw) => {
      const t0 = performance.now();
      const view = raw as SectorView;
      if (view.group) return { done: true, costMs: 0 };
      const lines = buildConstructLines(data);
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
      view.built = data.constructs.length;
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
  overlay.style.cssText = CSS;
  const panel = document.createElement('div');
  panel.style.cssText = PANEL;
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
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#6a8aaa;font-size:11px;margin:0.55rem 0 0';
  hint.textContent = 'WASD fly · Shift boost · click to look · landmarks always on';
  panel.appendChild(hint);

  const handle: SectorLabHandle = {
    get loaded() {
      return streamer.stats.loaded;
    },
    get pending() {
      return streamer.stats.pending;
    },
    get region() {
      const { sx, sz } = worldToSector(flight.pose.x, flight.pose.z);
      return maps.regionCode(sx, sz);
    },
    get coord() {
      const { sx, sz } = worldToSector(flight.pose.x, flight.pose.z);
      return formatMatrixCoord(
        worldToMatrixCoord(flight.pose.x, flight.pose.y, flight.pose.z, maps.regionCode(sx, sz)),
      );
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
      const { sx, sz } = worldToSector(flight.pose.x, flight.pose.z);
      return streamer.get(sx, sz)?.contentHash ?? null;
    },
  };
  window.__nonspaceSector = handle;
  root.dataset.lab = 'sector';
  root.dataset.landmarks = String(landmarks.length);
  root.dataset.streamRadius = String(STREAM_RADIUS);

  const fmt = (n: number, d = 1): string => n.toFixed(d);

  const lab: SectorLab = {
    update(dt) {
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
      const { sx, sz } = worldToSector(p.x, p.z);
      const o = {
        x: sx * SECTOR_SIZE + SECTOR_SIZE * 0.5,
        z: sz * SECTOR_SIZE + SECTOR_SIZE * 0.5,
      };
      grid.position.set(o.x, 0, o.z);
      const keep = new Set(streamer.loadedKeys());
      for (const [key, obj] of views) {
        if (!keep.has(key)) {
          scene.remove(obj);
          obj.geometry.dispose();
          (obj.material as LineBasicMaterial).dispose();
          views.delete(key);
        }
      }
      root.dataset.loaded = String(streamer.stats.loaded);
      root.dataset.region = maps.regionCode(sx, sz);
      root.dataset.hash = String(streamer.get(sx, sz)?.contentHash ?? '');
    },
    render(alpha) {
      cameraRig.apply(flight, alpha);
      const t = flight.telemetry;
      const s = streamer.stats;
      readout.textContent = [
        `coord     ${handle.coord}`,
        `region    ${handle.region}`,
        `loaded    ${s.loaded}  pending ${s.pending}  inflight ${s.inFlight}`,
        `main ms   ${fmt(s.lastMainMs, 2)}  max ${fmt(s.maxMainMs, 2)}`,
        `upload    ${fmt(s.lastUploadMs, 2)}  hitches>4ms ${s.hitchesOver4ms}`,
        `speed     ${fmt(t.speed, 1)} u/s  alt ${fmt(t.altitude, 0)}`,
        `landmarks ${landmarks.length}  manhattan ${handle.trafficManhattan ? 'yes' : 'NO'}`,
        `autofly   ${autofly ? 'ON' : 'off'}`,
      ].join('\n');
    },
    dispose() {
      overlay.remove();
      streamer.dispose();
      scene.remove(grid);
      scene.remove(lmPts);
      grid.geometry.dispose();
      (grid.material as LineBasicMaterial).dispose();
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
