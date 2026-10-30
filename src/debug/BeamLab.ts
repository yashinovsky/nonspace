/**
 * Dev route `?lab=beam` (M1.1). Exercises BeamBatch static + dynamic paths:
 * palette live-recolor, near-plane clip, sub-pixel width conservation,
 * vertex dwell, fog-to-black, and a 150k-segment stress lattice.
 */

import { Vector3 } from 'three';
import { createLoop } from '../core/loop';
import { createSaveStore } from '../core/save';
import { createSettingsStore, type QualitySetting } from '../core/settings';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
  type LineSet,
} from '../render/lines/BeamBatch';
import { createRenderer, type Renderer } from '../render/Renderer';
import type { DebugGui } from './DebugGui';
import { createGpuTimer, type GpuTimer } from './gpuTimer';

export const BEAM_SCENES = [
  'palette',
  'near',
  'thin',
  'dwell',
  'fog',
  'stress',
  'dynamic',
] as const;
export type BeamScene = (typeof BEAM_SCENES)[number];

export function isBeamScene(value: string | null): value is BeamScene {
  return (BEAM_SCENES as readonly string[]).includes(value ?? '');
}

export interface BeamLabHandle {
  readonly renderer: Renderer;
  readonly batch: BeamBatchGpu;
  readonly scene: BeamScene;
  readonly segmentCount: number;
  readonly lastGpuMs: number | null;
  setScene(scene: BeamScene): void;
  setWintermute(t: number): void;
  setWarmth(t: number): void;
  dispose(): void;
}

export interface BeamLabOptions {
  debug?: boolean;
  qualityOverride?: QualitySetting;
  scene?: BeamScene;
}

const STRESS_SEGMENTS = 150_000;

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

function writeSeg(
  set: LineSet,
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  c: Beam,
  intensity = 1,
  width = 1.5,
  flags = 0,
): void {
  const p = i * 6;
  set.positions[p] = ax;
  set.positions[p + 1] = ay;
  set.positions[p + 2] = az;
  set.positions[p + 3] = bx;
  set.positions[p + 4] = by;
  set.positions[p + 5] = bz;
  set.color[i] = c;
  set.intensity[i] = intensity;
  if (set.width) set.width[i] = width;
  if (set.flags) set.flags[i] = flags;
}

function addCube(
  set: LineSet,
  i: number,
  cx: number,
  cy: number,
  cz: number,
  size: number,
  c: Beam,
  intensity: number,
  flags = 0,
  width = 1.5,
): number {
  const h = size * 0.5;
  const x0 = cx - h;
  const x1 = cx + h;
  const y0 = cy - h;
  const y1 = cy + h;
  const z0 = cz - h;
  const z1 = cz + h;
  const e: Array<[number, number, number, number, number, number]> = [
    [x0, y0, z0, x1, y0, z0],
    [x1, y0, z0, x1, y1, z0],
    [x1, y1, z0, x0, y1, z0],
    [x0, y1, z0, x0, y0, z0],
    [x0, y0, z1, x1, y0, z1],
    [x1, y0, z1, x1, y1, z1],
    [x1, y1, z1, x0, y1, z1],
    [x0, y1, z1, x0, y0, z1],
    [x0, y0, z0, x0, y0, z1],
    [x1, y0, z0, x1, y0, z1],
    [x0, y1, z0, x0, y1, z1],
    [x1, y1, z0, x1, y1, z1],
  ];
  for (const [ax, ay, az, bx, by, bz] of e) {
    writeSeg(set, i++, ax, ay, az, bx, by, bz, c, intensity, width, flags);
  }
  return i;
}

function buildPaletteScene(): LineSet {
  const set = createLineSet(8 * 12 + 40, { width: true, flags: true });
  let i = 0;
  const hues: Beam[] = [
    Beam.GRID,
    Beam.AFTERGLOW,
    Beam.MITSU,
    Beam.TA,
    Beam.ESFA,
    Beam.AMBER,
    Beam.ICE,
    Beam.MIL,
  ];
  for (let k = 0; k < 8; k++) {
    i = addCube(set, i, (k - 3.5) * 1.6, 0, 0, 1.0, hues[k]!, k === 5 ? 4 : 1.1);
  }
  for (let x = -8; x <= 8; x++) {
    writeSeg(set, i++, x, -1.2, -6, x, -1.2, 6, Beam.GRID, 0.35, 1.0);
  }
  return sliceSet(set, i);
}

function buildNearScene(): LineSet {
  const set = createLineSet(80, { width: true, flags: true });
  let i = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const r = 0.35 + (k % 5) * 0.15;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.6;
    writeSeg(set, i++, x, y, 12, x, y, -12, huesOf(k), 1.4, 2.0);
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    writeSeg(
      set,
      i++,
      Math.cos(a) * 8,
      Math.sin(a) * 8,
      0.2,
      -Math.cos(a) * 8,
      -Math.sin(a) * 8,
      -0.2,
      Beam.AMBER,
      1.2,
      1.5,
    );
  }
  writeSeg(set, i++, 0, 0, 20, 0, 0, -20, Beam.ICE, 2.2, 2.5, BeamFlag.DWELL);
  return sliceSet(set, i);
}

function huesOf(k: number): Beam {
  return (k % 8) as Beam;
}

function buildThinScene(): LineSet {
  const set = createLineSet(80 * 2, { width: true, flags: true });
  let i = 0;
  const span = 30;
  for (let k = -20; k <= 20; k++) {
    const z = k * 1.4;
    writeSeg(set, i++, -span, 0, z, span, 0, z, Beam.GRID, 1, 0.25);
    writeSeg(set, i++, z, 0, -span, z, 0, span, Beam.GRID, 1, 0.25);
  }
  return sliceSet(set, i);
}

function buildDwellScene(): LineSet {
  const set = createLineSet(12 + 64 + 12, { width: true, flags: true });
  let i = 0;
  i = addCube(set, i, -2.2, 0, 0, 1.6, Beam.ICE, 1.1, 0, 1.5);
  i = addCube(set, i, 2.2, 0, 0, 1.6, Beam.ICE, 1.1, BeamFlag.DWELL, 1.5);
  const n = 32;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    writeSeg(
      set,
      i++,
      Math.cos(a0) * 2.8,
      Math.sin(a0) * 2.8,
      0,
      Math.cos(a1) * 2.8,
      Math.sin(a1) * 2.8,
      0,
      Beam.AMBER,
      1.4,
      1.5,
      BeamFlag.DWELL,
    );
  }
  return sliceSet(set, i);
}

function buildFogScene(): LineSet {
  const set = createLineSet(24 * 40 + 8, { width: true, flags: true });
  let i = 0;
  for (let s = 0; s < 40; s++) {
    const z0 = -s * 80;
    const z1 = -(s + 1) * 80;
    const w = 12 + s * 0.4;
    writeSeg(set, i++, -w, -w, z0, -w, -w, z1, Beam.GRID, 1.2);
    writeSeg(set, i++, w, -w, z0, w, -w, z1, Beam.GRID, 1.2);
    writeSeg(set, i++, -w, w, z0, -w, w, z1, Beam.GRID, 1.2);
    writeSeg(set, i++, w, w, z0, w, w, z1, Beam.GRID, 1.2);
    writeSeg(set, i++, -w, -w, z0, w, -w, z0, Beam.GRID, 0.7);
    writeSeg(set, i++, -w, w, z0, w, w, z0, Beam.GRID, 0.7);
    writeSeg(set, i++, -w, -w, z0, -w, w, z0, Beam.GRID, 0.7);
    writeSeg(set, i++, w, -w, z0, w, w, z0, Beam.GRID, 0.7);
  }
  return sliceSet(set, i);
}

/** Exactly 150k axis-aligned segments (50×50×20 cells × 3 axes). */
export function buildStressLattice(count = STRESS_SEGMENTS): LineSet {
  const nx = 50;
  const ny = 50;
  const nz = 20;
  const set = createLineSet(count, { width: true, flags: true });
  const ox = -40;
  const oy = -40;
  const oz = -16;
  const sx = 80 / nx;
  const sy = 80 / ny;
  const sz = 32 / nz;
  let i = 0;
  const push = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    c: Beam,
  ) => {
    if (i >= count) return;
    writeSeg(set, i++, ax, ay, az, bx, by, bz, c, 0.85, 1.2);
  };
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const x0 = ox + x * sx;
        const y0 = oy + y * sy;
        const z0 = oz + z * sz;
        push(x0, y0, z0, x0 + sx, y0, z0, Beam.GRID);
      }
    }
  }
  for (let x = 0; x < nx; x++) {
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const x0 = ox + x * sx;
        const y0 = oy + y * sy;
        const z0 = oz + z * sz;
        push(x0, y0, z0, x0, y0 + sy, z0, Beam.MITSU);
      }
    }
  }
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const x0 = ox + x * sx;
        const y0 = oy + y * sy;
        const z0 = oz + z * sz;
        push(x0, y0, z0, x0, y0, z0 + sz, Beam.TA);
      }
    }
  }
  while (i < count) {
    push(-40, -40, -16, 40, 40, 16, Beam.AMBER);
  }
  return set;
}

function buildEmptyDynamicPlaceholder(): LineSet {
  return createLineSet(0);
}

function sliceSet(set: LineSet, n: number): LineSet {
  return {
    positions: set.positions.subarray(0, n * 6),
    color: set.color.subarray(0, n),
    intensity: set.intensity.subarray(0, n),
    width: set.width?.subarray(0, n),
    flags: set.flags?.subarray(0, n),
  };
}

function placeCamera(renderer: Renderer, scene: BeamScene): void {
  const cam = renderer.cameras.matrix;
  if (scene === 'near') {
    cam.position.set(0, 0, 0.15);
    cam.lookAt(0, 0, -4);
  } else if (scene === 'fog') {
    cam.position.set(0, 0, 18);
    cam.lookAt(0, 0, -400);
  } else if (scene === 'stress') {
    cam.position.set(0, 28, 96);
    cam.lookAt(0, 0, 0);
  } else if (scene === 'thin') {
    cam.position.set(0, 14, 22);
    cam.lookAt(0, 0, 0);
  } else {
    cam.position.set(0, 0.8, 8.5);
    cam.lookAt(0, 0, 0);
  }
  cam.updateProjectionMatrix();
}

export async function startBeamLab(
  root: HTMLElement,
  opts: BeamLabOptions = {},
): Promise<BeamLabHandle> {
  document.title = 'NONSPACE beam lab';
  root.dataset.lab = 'beam';

  const save = createSaveStore();
  save.load();
  const settings = createSettingsStore(save.data.settings, (s) => {
    save.data.settings = s;
    save.commit();
  });
  const renderer = createRenderer({
    parent: root,
    settings,
    qualityOverride: opts.qualityOverride,
  });
  renderer.dynamicRes.enabled = false;

  const batch = createBeamBatch(renderer.palette, { capacity: 512 });
  renderer.scenes.matrix.add(batch.object);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="beam-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">BEAM · M1.1</div>
      <div data-testid="beam-scene-label"></div>
      <div data-testid="beam-stats" style="color:#6a8aaa;margin:0.25rem 0 0.55rem;font-size:12px"></div>
      <div class="row" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin:0 0 0.55rem" data-testid="beam-scenes"></div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
        <button type="button" data-testid="beam-wintermute">Wintermute</button>
        <button type="button" data-testid="beam-warmth">Warmth</button>
        <button type="button" data-testid="beam-reset">Reset palette</button>
      </div>
    </div>
  `;
  const btnCss =
    'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer';
  overlay.querySelectorAll('button').forEach((b) => {
    (b as HTMLButtonElement).style.cssText = btnCss;
  });
  const sceneRow = overlay.querySelector('[data-testid="beam-scenes"]')!;
  for (const id of BEAM_SCENES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = id;
    b.style.cssText = btnCss;
    b.dataset.scene = id;
    b.dataset.testid = `beam-scene-${id}`;
    sceneRow.appendChild(b);
  }
  root.appendChild(overlay);

  const label = overlay.querySelector('[data-testid="beam-scene-label"]')!;
  const statsEl = overlay.querySelector('[data-testid="beam-stats"]')!;

  let scene: BeamScene = opts.scene ?? 'palette';
  let wintermute = 0;
  let warmth = 0;
  let lastGpuMs: number | null = null;
  let t = 0;
  const a = new Vector3();
  const b = new Vector3();

  const applyScene = (next: BeamScene): void => {
    scene = next;
    wintermute = 0;
    warmth = 0;
    renderer.palette.reset();
    placeCamera(renderer, scene);
    batch.beginDynamic();
    batch.endDynamic();
    if (scene === 'palette') batch.setStatic(buildPaletteScene());
    else if (scene === 'near') batch.setStatic(buildNearScene());
    else if (scene === 'thin') batch.setStatic(buildThinScene());
    else if (scene === 'dwell') batch.setStatic(buildDwellScene());
    else if (scene === 'fog') batch.setStatic(buildFogScene());
    else if (scene === 'stress') batch.setStatic(buildStressLattice());
    else batch.setStatic(buildEmptyDynamicPlaceholder());
    label.textContent = scene.toUpperCase();
    root.dataset.scene = scene;
    root.dataset.segments = String(batch.staticCount);
    for (const btn of sceneRow.querySelectorAll('button')) {
      const on = (btn as HTMLButtonElement).dataset.scene === scene;
      (btn as HTMLButtonElement).style.borderColor = on ? '#ffb000' : '#2a4a66';
    }
  };

  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const id = target.dataset.scene;
    if (id && isBeamScene(id)) applyScene(id);
    else if (target.dataset.testid === 'beam-wintermute') {
      wintermute = wintermute > 0.5 ? 0 : 1;
      renderer.palette.lerpAllTo({ r: 1, g: 1, b: 1 }, wintermute);
    } else if (target.dataset.testid === 'beam-warmth') {
      warmth = warmth > 0.5 ? 0 : 0.7;
      renderer.palette.addWarmth(warmth);
    } else if (target.dataset.testid === 'beam-reset') {
      wintermute = 0;
      warmth = 0;
      renderer.palette.reset();
    }
  });

  const resize = (): void => {
    renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  };
  resize();
  window.addEventListener('resize', resize);

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (opts.debug) {
    gpuTimer = createGpuTimer(renderer.three.getContext() as WebGL2RenderingContext);
    const { createDebugGui: makeGui } = await import('./DebugGui');
    gui = makeGui({ gpuTimerAvailable: gpuTimer !== null });
    renderer.attachDebug(gui.pane);
    const beam = gui.pane.addFolder({ title: 'beam' });
    beam.addBinding(batch.style, 'sigma', { min: 0.15, max: 3, step: 0.05 });
    beam.addBinding(batch.style, 'dwell', { min: 0, max: 6, step: 0.05 });
    beam.addBinding(batch.style, 'dwellSigma', { min: 0.4, max: 8, step: 0.1, label: 'dwell σ' });
    beam.addBinding(batch.style, 'fogStart', { min: 0, max: 400, step: 5, label: 'fog start' });
    beam.addBinding(batch.style, 'fogDensity', {
      min: 0,
      max: 0.004,
      step: 0.00005,
      label: 'fog density',
    });
  }

  const loop = createLoop({
    update(dt) {
      t += dt;
      if (scene === 'thin' || scene === 'palette' || scene === 'dwell') {
        const cam = renderer.cameras.matrix;
        const r = scene === 'thin' ? 24 : 8.5;
        const y = scene === 'thin' ? 14 : 0.8;
        cam.position.set(Math.sin(t * 0.12) * r, y, Math.cos(t * 0.12) * r);
        cam.lookAt(0, 0, 0);
      }
      if (scene === 'near') {
        const cam = renderer.cameras.matrix;
        cam.position.set(Math.sin(t * 0.25) * 0.2, Math.cos(t * 0.2) * 0.12, 0.15);
        cam.lookAt(0, 0, -4);
      }
      if (scene === 'dynamic') {
        batch.beginDynamic();
        const n = 48;
        for (let k = 0; k < n; k++) {
          const a0 = t * 0.7 + (k / n) * Math.PI * 2;
          const a1 = t * 0.7 + ((k + 1) / n) * Math.PI * 2;
          const r = 2.4;
          a.set(Math.cos(a0) * r, Math.sin(a0) * r, Math.sin(t + k * 0.2));
          b.set(Math.cos(a1) * r, Math.sin(a1) * r, Math.sin(t + (k + 1) * 0.2));
          batch.push(a, b, Beam.AMBER, 1.6, 2, BeamFlag.DWELL);
        }
        for (let k = 0; k < 8; k++) {
          const ang = t + (k * Math.PI) / 4;
          a.set(0, 0, 0);
          b.set(Math.cos(ang) * 3.5, Math.sin(ang) * 3.5, Math.cos(t * 0.4) * 1.2);
          batch.push(a, b, huesOf(k), 1.1, 1.5);
        }
        batch.endDynamic();
        root.dataset.segments = String(batch.dynamicCount);
      }
    },
    render(_alpha, frameDt) {
      renderer.endFrame(frameDt, gpuTimer?.lastMs ?? null);
    },
  });

  let last = performance.now();
  let first = true;
  const frame = (now: number): void => {
    const dt = now - last;
    last = now;
    gpuTimer?.begin();
    loop.frame(now);
    gpuTimer?.end();
    lastGpuMs = gpuTimer ? gpuTimer.poll() : null;
    gui?.frame(dt, lastGpuMs);
    const segs = scene === 'dynamic' ? batch.dynamicCount : batch.staticCount;
    statsEl.textContent = `${segs} segs · gpu ${lastGpuMs === null ? 'n/a' : `${lastGpuMs.toFixed(2)} ms`}`;
    if (first) {
      first = false;
      root.dataset.status = 'running';
    }
  };
  renderer.three.setAnimationLoop(frame);
  applyScene(scene);

  const handle: BeamLabHandle = {
    renderer,
    batch,
    get scene() {
      return scene;
    },
    get segmentCount() {
      return scene === 'dynamic' ? batch.dynamicCount : batch.staticCount;
    },
    get lastGpuMs() {
      return lastGpuMs;
    },
    setScene: applyScene,
    setWintermute(v) {
      wintermute = v;
      renderer.palette.lerpAllTo({ r: 1, g: 1, b: 1 }, v);
    },
    setWarmth(v) {
      warmth = v;
      renderer.palette.addWarmth(v);
    },
    dispose() {
      renderer.three.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      overlay.remove();
      renderer.scenes.matrix.remove(batch.object);
      batch.dispose();
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      if (window.__nonspaceBeam === handle) delete window.__nonspaceBeam;
    },
  };
  window.__nonspaceBeam = handle;
  (window as unknown as { __nonspace: { renderer: Renderer; beamLab: BeamLabHandle } }).__nonspace =
    { renderer, beamLab: handle };
  return handle;
}

declare global {
  interface Window {
    __nonspaceBeam?: BeamLabHandle;
  }
}
