/**
 * Dev route `?lab=look` (M1.9). Art-integration scene: ground grid, lattice,
 * hand-placed ESFA / Mitsubishi / T-A constructs, a white ICE shell, a black
 * ICE shard, Manhattan traffic, placeholder spiral-arm points, free-fly.
 * Query: `?lab=look&quality=medium&gray=1`.
 */

import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { CORPS } from '../content/corps';
import { pcg32 } from '../core/rng';
import type { CameraRig } from '../player/CameraRig';
import type { FlightController } from '../player/FlightController';
import { createBlackIceSolid, octahedronLineSet } from '../render/faces/blackIce';
import { createUvEdgeMaterial, setUvEdgeTime } from '../render/faces/uvEdge';
import { createGroundGrid, type GroundGrid } from '../render/grid/GroundGrid';
import { createLocalLattice, type LocalLattice } from '../render/grid/LocalLattice';
import {
  BEAM_COUNT,
  Beam,
  BeamFlag,
  createBeamBatch,
  lineSetCount,
  type BeamBatchGpu,
  type LineSet,
} from '../render/lines/BeamBatch';
import { BEAM_HEX, type Palette } from '../render/palette';
import {
  createPointBatch,
  createPointSet,
  createTrafficBatch,
  type GpuPointBatch,
  type GpuTrafficBatch,
  type PointSet,
} from '../render/points/PointBatch';
import type { Renderer } from '../render/Renderer';
import { generate } from '../world/constructs/grammar';
import type { PrimitiveSpec } from '../world/constructs/primitives';

export const LOOK_TRAFFIC = 720;
export const LOOK_SKY_POINTS = 2_400;
export const LOOK_START = { x: 6, y: 22, z: 86, yaw: 0.04, pitch: -0.12 } as const;

export interface LookLab {
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
  resetPose(): void;
  readonly grayscale: boolean;
  readonly time: number;
  readonly stats: LookLabStats;
}

export interface LookLabStats {
  segments: number;
  dwell: number;
  lattice: number;
  traffic: number;
  sky: number;
}

export interface ScreenXy {
  x: number;
  y: number;
}

export interface LookLabHandle {
  grayscale: boolean;
  time: number;
  fps: number;
  stats: LookLabStats;
  iceScreen: ScreenXy;
  baitScreen: ScreenXy;
  esfaScreen: ScreenXy;
  mitsuScreen: ScreenXy;
  taScreen: ScreenXy;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
  resetPose(): void;
}

export interface LookLabOptions {
  renderer: Renderer;
  flight: FlightController;
  cameraRig: CameraRig;
  root: HTMLElement;
  gray?: string | null;
}

declare global {
  interface Window {
    __nonspaceLook?: LookLabHandle;
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

const BTN =
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer';

const WHITE_ICE: PrimitiveSpec = {
  kind: 'nestedPoly',
  solid: 'octa',
  shells: 3,
  rotationAxes: [0, 1, 2],
  radius: 9,
  hatch: true,
};

const MITSU_SPEC: PrimitiveSpec = {
  kind: 'cubeStack',
  n: 5,
  m: 6,
  k: 5,
  gap: 0.28,
  blinkMask: false,
};

export function countDwellFlags(set: LineSet): number {
  const flags = set.flags;
  if (!flags) return 0;
  let n = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i]! & BeamFlag.DWELL) n++;
  return n;
}

/** Rec. 709 luma. `reset()` first so a second call does not gray already-gray values. */
export function setPaletteGrayscale(palette: Palette, on: boolean): void {
  palette.reset();
  if (!on) return;
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < BEAM_COUNT; i++) {
    palette.get(i as Beam, rgb);
    const y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    palette.set(i as Beam, { r: y, g: y, b: y });
  }
}

/**
 * Miniature 3-arm log spiral so the sky reads without pulling M2.4's 40k
 * PointBatch into the look shot (or the default-boot graph).
 */
export function fillPlaceholderArms(set: PointSet, count: number, seed = 0x1091_0009): number {
  const n = Math.max(0, Math.min(count, set.color.length));
  const perArm = Math.floor(n / 3);
  const rng = pcg32(seed, 1);
  const sizes = set.size;
  let i = 0;
  for (let arm = 0; arm < 3; arm++) {
    const phase = (arm * Math.PI * 2) / 3;
    for (let k = 0; k < perArm; k++, i++) {
      const u = (k + rng.next()) / Math.max(perArm, 1);
      const theta = u * 1.05 * Math.PI * 2;
      const r0 = 48 + u * 210;
      const spread = rng.normal(0, 7 + u * 10);
      const a = theta + phase;
      const p = i * 3;
      set.positions[p] = r0 * Math.cos(a) + Math.cos(a + Math.PI / 2) * spread;
      set.positions[p + 1] = 58 + rng.normal(0, 7) + u * 18;
      set.positions[p + 2] = r0 * Math.sin(a) - 70 + Math.sin(a + Math.PI / 2) * spread;
      set.color[i] = Beam.MIL;
      set.intensity[i] = rng.float(0.45, 1.35);
      if (sizes) sizes[i] = rng.float(1.5, 2.6);
    }
  }
  while (i < n) {
    const p = i * 3;
    set.positions[p] = rng.float(-220, 220);
    set.positions[p + 1] = rng.float(70, 110);
    set.positions[p + 2] = rng.float(-280, 40);
    set.color[i] = Beam.MIL;
    set.intensity[i] = rng.float(0.25, 0.7);
    if (sizes) sizes[i] = 1.5;
    i++;
  }
  return n;
}

function manhattanLoop(cx: number, cz: number, w: number, d: number, y: number): Float32Array {
  return new Float32Array([
    cx - w,
    y,
    cz - d,
    cx + w,
    y,
    cz - d,
    cx + w,
    y,
    cz + d,
    cx - w,
    y,
    cz + d,
    cx - w,
    y,
    cz - d,
  ]);
}

function beamColor(index: Beam, intensity: number): Color {
  const hex = BEAM_HEX[index]!;
  return new Color().setRGB(
    (((hex >> 16) & 255) / 255) * intensity,
    (((hex >> 8) & 255) / 255) * intensity,
    ((hex & 255) / 255) * intensity,
  );
}

function placeLines(
  renderer: Renderer,
  lines: LineSet,
  x: number,
  y: number,
  z: number,
  scale = 1,
): BeamBatchGpu {
  const batch = createBeamBatch(renderer.palette, { capacity: Math.max(lineSetCount(lines), 8) });
  batch.setStatic(lines);
  batch.object.position.set(x, y, z);
  if (scale !== 1) batch.object.scale.setScalar(scale);
  batch.object.updateMatrix();
  renderer.scenes.matrix.add(batch.object);
  return batch;
}

function groundY(minY: number, scale = 1): number {
  return -minY * scale;
}

function makeBait(): Mesh {
  const geom = new BoxGeometry(14, 10, 2.2);
  const mat = new MeshBasicMaterial({
    color: beamColor(Beam.AMBER, 4),
    toneMapped: false,
  });
  const mesh = new Mesh(geom, mat);
  mesh.position.set(-20, 13, 6);
  mesh.frustumCulled = false;
  mesh.name = 'lookLabBait';
  return mesh;
}

function project(renderer: Renderer, x: number, y: number, z: number): ScreenXy {
  const v = new Vector3(x, y, z);
  renderer.cameras.matrix.updateMatrixWorld();
  v.project(renderer.cameras.matrix);
  return {
    x: (v.x * 0.5 + 0.5) * renderer.cssWidth,
    y: (-v.y * 0.5 + 0.5) * renderer.cssHeight,
  };
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}

export function installLookLab(opts: LookLabOptions): LookLab {
  const { renderer, flight, cameraRig, root } = opts;
  const grid: GroundGrid = createGroundGrid(renderer.palette);
  const lattice: LocalLattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);

  const esfa = generate(CORPS.esfa.spec, {
    color: Beam.ESFA,
    intensity: 1.15,
    lod: 'near',
    seed: 1,
  });
  const mitsu = generate(MITSU_SPEC, { color: Beam.MITSU, intensity: 1.05, lod: 'near', seed: 2 });
  const ta = generate(CORPS.tessierAshpool.spec, {
    color: Beam.TA,
    intensity: 1.1,
    lod: 'near',
    seed: 3,
  });
  const white = generate(WHITE_ICE, { color: Beam.ICE, intensity: 1.65, lod: 'near', seed: 4 });

  const mitsuScale = 3.4;
  const esfaBatch = placeLines(renderer, esfa.lines, -42, groundY(esfa.bounds.min.y), -22);
  const mitsuBatch = placeLines(
    renderer,
    mitsu.lines,
    10,
    groundY(mitsu.bounds.min.y, mitsuScale),
    -6,
    mitsuScale,
  );
  const taBatch = placeLines(renderer, ta.lines, 54, groundY(ta.bounds.min.y), -28);
  const whiteBatch = placeLines(renderer, white.lines, 28, 16, 18);

  const bait = makeBait();
  renderer.scenes.matrix.add(bait);

  const solid = createBlackIceSolid(1);
  solid.mesh.position.set(-18, 13.5, 32);
  solid.mesh.scale.set(6.2, 10.5, 4.4);
  solid.mesh.rotation.set(0.18, 0.42, 0.08);
  renderer.scenes.blackIce.add(solid.mesh);

  const uvMat = createUvEdgeMaterial();
  const edges = createBeamBatch(renderer.palette, { material: uvMat, capacity: 16 });
  edges.setStatic(octahedronLineSet(1.05, 1.5));
  edges.object.position.copy(solid.mesh.position);
  edges.object.scale.copy(solid.mesh.scale);
  edges.object.rotation.copy(solid.mesh.rotation);
  renderer.scenes.matrix.add(edges.object);

  const skySet = createPointSet(LOOK_SKY_POINTS, { size: true });
  fillPlaceholderArms(skySet, LOOK_SKY_POINTS);
  const skyBatch: GpuPointBatch = createPointBatch({
    capacity: LOOK_SKY_POINTS,
    palette: renderer.palette,
    fogDensity: 0.00012,
    refDistance: 160,
  });
  skyBatch.setStatic(skySet);
  renderer.scenes.matrix.add(skyBatch.object);

  const trafficBatch: GpuTrafficBatch = createTrafficBatch({
    capacity: LOOK_TRAFFIC,
    palette: renderer.palette,
  });
  const paths = [
    manhattanLoop(0, -8, 70, 42, 1.8),
    manhattanLoop(-40, -36, 36, 24, 1.8),
    manhattanLoop(36, -24, 32, 28, 3.2),
    manhattanLoop(8, 20, 48, 22, 6.5),
    manhattanLoop(-12, -80, 90, 36, 12),
  ];
  trafficBatch.setPaths(paths, true);
  const rng = pcg32(0x1091_a11, 3);
  const pathIndex = new Uint16Array(LOOK_TRAFFIC);
  const offset = new Float32Array(LOOK_TRAFFIC);
  const speed = new Float32Array(LOOK_TRAFFIC);
  const color = new Uint8Array(LOOK_TRAFFIC);
  const intensity = new Float32Array(LOOK_TRAFFIC);
  const size = new Float32Array(LOOK_TRAFFIC);
  const twinkle = new Float32Array(LOOK_TRAFFIC);
  const hues: Beam[] = [Beam.AMBER, Beam.MITSU, Beam.ESFA, Beam.GRID, Beam.TA, Beam.ICE];
  for (let i = 0; i < LOOK_TRAFFIC; i++) {
    pathIndex[i] = rng.below(paths.length);
    offset[i] = rng.next();
    speed[i] = rng.float(16, 48);
    color[i] = hues[i % hues.length]!;
    intensity[i] = rng.float(1.0, 2.2);
    size[i] = rng.float(1.6, 3.0);
    twinkle[i] = rng.float(0.12, 0.5);
  }
  trafficBatch.setInstances({ pathIndex, offset, speed, color, intensity, size, twinkle });
  renderer.scenes.matrix.add(trafficBatch.object);

  const dwell =
    countDwellFlags(esfa.lines) +
    countDwellFlags(mitsu.lines) +
    countDwellFlags(ta.lines) +
    countDwellFlags(white.lines);
  const segments =
    esfa.stats.segments + mitsu.stats.segments + ta.stats.segments + white.stats.segments;

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="look-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">LOOK · M1.9</div>
      <div data-testid="look-stats" style="color:#c8e4ff;margin:0 0 0.45rem;font-size:12px;white-space:pre"></div>
      <div style="color:#6a8aaa;font-size:11px;margin:0 0 0.45rem">WASD fly · Space/Ctrl rise · Shift boost · click to look</div>
      <button type="button" data-testid="look-gray" style="${BTN}">grayscale</button>
    </div>
  `;
  root.appendChild(overlay);
  const statsEl = overlay.querySelector('[data-testid="look-stats"]')!;
  const grayBtn = overlay.querySelector('[data-testid="look-gray"]') as HTMLButtonElement;

  let grayscale = opts.gray === '1' || opts.gray === 'true';
  let time = 0;
  let fps = 60;
  let lastFrame = performance.now();

  const applyStartPose = (): void => {
    flight.setPose({
      x: LOOK_START.x,
      y: LOOK_START.y,
      z: LOOK_START.z,
      yaw: LOOK_START.yaw,
      pitch: LOOK_START.pitch,
      vx: 0,
      vy: 0,
      vz: 0,
      bank: 0,
      fov: flight.params.fovBase,
    });
  };
  applyStartPose();
  cameraRig.apply(flight, 1);

  const applyGray = (): void => {
    setPaletteGrayscale(renderer.palette, grayscale);
    root.dataset.gray = grayscale ? '1' : '0';
    grayBtn.style.borderColor = grayscale ? '#ffb000' : '#2a4a66';
    grayBtn.textContent = grayscale ? 'grayscale on' : 'grayscale';
  };
  applyGray();

  grayBtn.addEventListener('click', () => {
    grayscale = !grayscale;
    applyGray();
  });

  const syncHud = (): void => {
    const t = flight.telemetry;
    statsEl.textContent = [
      `fps ${fps.toFixed(0)}  gpu ${root.dataset.gpuMs ?? 'n/a'} ms`,
      `alt ${t.altitude.toFixed(1)} u  spd ${t.speed.toFixed(0)}`,
      `seg ${segments}  dwell ${dwell}  lattice ${lattice.count}`,
      `traffic ${LOOK_TRAFFIC}  sky ${LOOK_SKY_POINTS}`,
    ].join('\n');
    root.dataset.lab = 'look';
    root.dataset.segments = String(segments);
    root.dataset.dwell = String(dwell);
    root.dataset.latticeCount = String(lattice.count);
    root.dataset.trafficCount = String(LOOK_TRAFFIC);
    root.dataset.skyPoints = String(LOOK_SKY_POINTS);
    root.dataset.persist = renderer.quality.persistence ? '1' : '0';
    root.dataset.fps = fps.toFixed(1);
  };

  const follow = (): void => {
    const cam = renderer.cameras.matrix;
    grid.follow(cam.position);
    lattice.radius = renderer.quality.latticeRadius;
    lattice.update(cam.position);
    skyBatch.setViewport(renderer.internalWidth, renderer.internalHeight);
    trafficBatch.setViewport(renderer.internalWidth, renderer.internalHeight);
  };

  const applyTime = (t: number): void => {
    time = t;
    trafficBatch.setTime(t);
    skyBatch.setTime(t);
    setUvEdgeTime(uvMat, t);
    whiteBatch.object.rotation.y = t * 0.22;
    whiteBatch.object.rotation.x = t * 0.05;
    solid.mesh.rotation.y = 0.42 + t * 0.11;
    edges.object.rotation.y = solid.mesh.rotation.y;
  };

  const handle: LookLabHandle = {
    get grayscale() {
      return grayscale;
    },
    get time() {
      return time;
    },
    get fps() {
      return fps;
    },
    get stats() {
      return {
        segments,
        dwell,
        lattice: lattice.count,
        traffic: LOOK_TRAFFIC,
        sky: LOOK_SKY_POINTS,
      };
    },
    get iceScreen() {
      return project(renderer, solid.mesh.position.x, solid.mesh.position.y, solid.mesh.position.z);
    },
    get baitScreen() {
      return project(renderer, bait.position.x, bait.position.y, bait.position.z);
    },
    get esfaScreen() {
      return project(renderer, esfaBatch.object.position.x, 10, esfaBatch.object.position.z);
    },
    get mitsuScreen() {
      return project(renderer, mitsuBatch.object.position.x, 10, mitsuBatch.object.position.z);
    },
    get taScreen() {
      return project(renderer, taBatch.object.position.x, 8, taBatch.object.position.z);
    },
    setGrayscale(on) {
      grayscale = on;
      applyGray();
    },
    setTime(t) {
      applyTime(t);
    },
    resetPose() {
      applyStartPose();
    },
  };
  window.__nonspaceLook = handle;
  follow();
  applyTime(0);
  syncHud();

  const batches = [esfaBatch, mitsuBatch, taBatch, whiteBatch, edges];

  return {
    get grayscale() {
      return grayscale;
    },
    get time() {
      return time;
    },
    get stats() {
      return handle.stats;
    },
    setGrayscale: handle.setGrayscale,
    setTime: handle.setTime,
    resetPose: handle.resetPose,
    update(dt) {
      applyTime(time + dt);
    },
    render(alpha) {
      cameraRig.apply(flight, alpha);
      follow();
      const now = performance.now();
      const frameDt = Math.max(0.001, (now - lastFrame) / 1000);
      lastFrame = now;
      fps = fps * 0.9 + (1 / frameDt) * 0.1;
      syncHud();
    },
    dispose() {
      overlay.remove();
      delete root.dataset.lab;
      delete root.dataset.gray;
      delete root.dataset.segments;
      delete root.dataset.dwell;
      delete root.dataset.latticeCount;
      delete root.dataset.trafficCount;
      delete root.dataset.skyPoints;
      delete root.dataset.persist;
      delete root.dataset.fps;
      if (window.__nonspaceLook === handle) delete window.__nonspaceLook;
      renderer.scenes.matrix.remove(grid.object);
      renderer.scenes.matrix.remove(lattice.object);
      renderer.scenes.matrix.remove(bait);
      renderer.scenes.matrix.remove(skyBatch.object);
      renderer.scenes.matrix.remove(trafficBatch.object);
      renderer.scenes.blackIce.remove(solid.mesh);
      for (const b of batches) renderer.scenes.matrix.remove(b.object);
      grid.dispose();
      lattice.dispose();
      for (const b of batches) b.dispose();
      uvMat.dispose();
      solid.dispose();
      skyBatch.dispose();
      trafficBatch.dispose();
      disposeObject(bait);
      renderer.palette.reset();
    },
  };
}
