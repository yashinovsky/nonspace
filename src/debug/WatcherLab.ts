/**
 * Dev route `?lab=watchers` (M4.6). Turing / sysop sweep fans, detection
 * cones, trace gain, DECOY lure stub, radar blips. Lazy `?lab=` chunk —
 * default boot never fetches it.
 *
 * Playwright freezes `setAnimationLoop` before any canvas snapshot and paints
 * with `paint()` (`hud.update(0)` + `endFrame`). No live rAF warmup.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  type Object3D,
} from 'three';
import type { EventBus } from '../core/events';
import { createTrace, type Trace } from '../deck/Trace';
import { createHud, type Hud } from '../hud/Hud';
import { BEAM_HEX } from '../render/palette';
import { Beam } from '../render/lines/BeamBatch';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';
import type { WatcherInstance } from '../world/Sector';
import {
  createWatcherField,
  DECOY_SECONDS,
  watcherSpec,
  type WatcherField,
} from '../world/watchers/Watcher';

export interface ScreenXy {
  x: number;
  y: number;
}

export interface WatcherLab {
  update(dt: number): void;
  dispose(): void;
}

export interface WatcherLabHandle {
  trace: number;
  exposed: boolean;
  lureRemaining: number;
  traceMul: number;
  blipCount: number;
  yaw: number[];
  lured: boolean[];
  turingScreen: ScreenXy;
  fanScreen: ScreenXy;
  setPlayer(x: number, y: number, z: number): void;
  setTime(t: number): void;
  dropLure(): void;
  clearLures(): void;
  advance(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceWatchers?: WatcherLabHandle;
  }
}

export interface WatcherLabOptions {
  renderer: Renderer;
  events: EventBus;
  root: HTMLElement;
  reduceFlashing?: () => boolean;
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
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer;margin:0 0.25rem 0.25rem 0';

const WATCHERS: WatcherInstance[] = [
  { x: 0, y: 8, z: 0, kind: 'turing', yaw0: 0.4 },
  { x: 52, y: 6, z: -22, kind: 'sysop', yaw0: -1.1 },
];

const PLAYER0 = { x: 27.3, y: 8, z: 64.4 };
const LURE = { x: 90, y: 8, z: -36 };

const _proj = new Vector3();

function project(renderer: Renderer, x: number, y: number, z: number): ScreenXy {
  _proj.set(x, y, z);
  renderer.cameras.matrix.updateMatrixWorld();
  _proj.project(renderer.cameras.matrix);
  return {
    x: (_proj.x * 0.5 + 0.5) * renderer.cssWidth,
    y: (-_proj.y * 0.5 + 0.5) * renderer.cssHeight,
  };
}

function beamColor(index: Beam, intensity: number): Color {
  const hex = BEAM_HEX[index]!;
  return new Color().setRGB(
    (((hex >> 16) & 255) / 255) * intensity,
    (((hex >> 8) & 255) / 255) * intensity,
    ((hex & 255) / 255) * intensity,
  );
}

function makeFloor(size: number, divs: number, color: Color): LineSegments {
  const verts: number[] = [];
  const h = size * 0.5;
  for (let i = 0; i <= divs; i++) {
    const t = (i / divs) * size - h;
    verts.push(-h, 0, t, h, 0, t);
    verts.push(t, 0, -h, t, 0, h);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(verts, 3));
  const mat = new LineBasicMaterial({ color, toneMapped: false });
  const mesh = new LineSegments(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    const mesh = child as LineSegments;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}

export function installWatcherLab(opts: WatcherLabOptions): WatcherLab {
  const { renderer, events, root } = opts;
  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.4;

  const cam = renderer.cameras.matrix;
  cam.position.set(48, 42, 96);
  cam.lookAt(10, 6, 20);
  cam.near = 0.5;
  cam.far = 8_000;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();

  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();

  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  pass.params.enableBarrel = true;
  pass.params.enableJitter = false;
  pass.params.enableFlicker = false;
  pass.params.enableGrain = true;
  pass.params.enableVignette = true;

  const floor = makeFloor(180, 18, beamColor(Beam.GRID, 0.45));
  renderer.scenes.matrix.add(floor);

  const trace: Trace = createTrace({ events });
  const field: WatcherField = createWatcherField({
    watchers: WATCHERS,
    palette: renderer.palette,
    scene: renderer.scenes.matrix,
    events,
    trace,
    player: { ...PLAYER0 },
    heading: 0,
    drawProbe: true,
  });
  field.setTime(0);

  const hud: Hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing,
  });
  hud.setMode('TRANSIT');
  hud.setCoords('EURO 0268.00 / 0056.00 / 0008');
  hud.setNeural(18);
  hud.setTrace(0);
  hud.setBlips(field.blips);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="watchers-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">WATCHERS · M4.6</div>
      <div data-testid="watchers-stats" style="color:#c8e4ff;margin:0 0 0.45rem;font-size:12px;white-space:pre"></div>
      <div>
        <button type="button" data-testid="watchers-decoy" style="${BTN}">DECOY</button>
        <button type="button" data-testid="watchers-clear" style="${BTN}">clear lure</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const statsEl = overlay.querySelector('[data-testid="watchers-stats"]')!;
  overlay.querySelector('[data-testid="watchers-decoy"]')!.addEventListener('click', () => {
    field.dropLure(LURE, DECOY_SECONDS);
  });
  overlay.querySelector('[data-testid="watchers-clear"]')!.addEventListener('click', () => {
    field.clearLures();
  });

  const fanPoint = (): { x: number; y: number; z: number } => {
    const w = field.states[0]!;
    const spec = watcherSpec(w.kind);
    const reach = spec.range * 0.55;
    return {
      x: w.x + Math.sin(w.yaw) * reach,
      y: w.y,
      z: w.z + Math.cos(w.yaw) * reach,
    };
  };

  const syncHud = (): void => {
    hud.setTrace(trace.value);
    hud.setBlips(field.blips);
    hud.setMode(field.exposed ? 'SWEEP' : field.lureRemaining > 0 ? 'DECOY' : 'TRANSIT');
  };

  const paint = (): void => {
    field.draw();
    syncHud();
    hud.update(0);
    const w = field.states[0]!;
    statsEl.textContent = `trace ${trace.value.toFixed(1)}  exposed ${field.exposed ? 'Y' : 'n'}  lure ${field.lureRemaining.toFixed(1)}s\nyaw ${w.yaw.toFixed(2)}  blips ${field.blips.length}`;
    root.dataset.trace = trace.value.toFixed(2);
    root.dataset.exposed = field.exposed ? '1' : '0';
  };

  const handle: WatcherLabHandle = {
    get trace() {
      return trace.value;
    },
    get exposed() {
      return field.exposed;
    },
    get lureRemaining() {
      return field.lureRemaining;
    },
    get traceMul() {
      return field.traceMul;
    },
    get blipCount() {
      return field.blips.length;
    },
    get yaw() {
      return field.states.map((s) => s.yaw);
    },
    get lured() {
      return field.states.map((s) => s.lured);
    },
    get turingScreen() {
      const w = field.states[0]!;
      return project(renderer, w.x, w.y, w.z);
    },
    get fanScreen() {
      const p = fanPoint();
      return project(renderer, p.x, p.y, p.z);
    },
    setPlayer(x, y, z) {
      field.setPlayer(x, y, z);
    },
    setTime(t) {
      field.setTime(t);
    },
    dropLure() {
      field.dropLure(LURE, DECOY_SECONDS);
    },
    clearLures() {
      field.clearLures();
    },
    advance(dt) {
      field.step(dt);
      events.flush();
      paint();
    },
    paint,
  };

  window.__nonspaceWatchers = handle;
  root.dataset.lab = 'watchers';
  paint();

  return {
    update(dt) {
      field.step(dt);
      events.flush();
      paint();
    },
    dispose() {
      overlay.remove();
      hud.dispose();
      field.dispose();
      renderer.scenes.matrix.remove(floor);
      disposeObject(floor);
      if (window.__nonspaceWatchers === handle) delete window.__nonspaceWatchers;
      delete root.dataset.lab;
      delete root.dataset.trace;
      delete root.dataset.exposed;
    },
  };
}
