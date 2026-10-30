/**
 * Dev route `?lab=hud` (M3.2). Ono-Sendai overlay on a barrel-warped lattice
 * so we can prove the HUD composites after the CRT pass. Lazy `?lab=` chunk.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import type { EventBus } from '../core/events';
import { createHud, type Hud } from '../hud/Hud';
import { TERMINAL_CHARS_PER_SEC } from '../hud/Terminal';
import { BEAM_HEX } from '../render/palette';
import { Beam } from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';

export interface HudLab {
  update(dt: number): void;
  dispose(): void;
  readonly hud: Hud;
}

export interface HudLabHandle {
  neural: number;
  trace: number;
  flatline: boolean;
  mode: string;
  terminalVisible: string;
  terminalPending: number;
  eegVariance: number;
  layout: Hud['layout'];
  pipLink: boolean;
  setNeural(n: number): void;
  setTrace(n: number): void;
  setFlatline(on: boolean): void;
  setMode(mode: string): void;
  print(text: string, wintermute?: boolean): void;
  clearTerminal(): void;
  setPain(n: number): void;
  setPipLink(on: boolean): void;
  setTime(t: number): void;
  update(dt: number): void;
}

declare global {
  interface Window {
    __nonspaceHud?: HudLabHandle;
  }
}

export interface HudLabOptions {
  renderer: Renderer;
  events: EventBus;
  root: HTMLElement;
  reduceFlashing: () => boolean;
}

const CSS = [
  'position:fixed',
  'inset:0',
  'pointer-events:none',
  'font:12px/1.35 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:20',
].join(';');

const PANEL = [
  'position:absolute',
  'pointer-events:auto',
  'left:0.6rem',
  'top:50%',
  'transform:translateY(-50%)',
  'min-width:16rem',
  'background:rgba(0,0,0,0.55)',
  'padding:0.55rem 0.7rem 0.65rem',
  'border:1px solid #1a3348',
].join(';');

const BTN =
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.22rem 0.45rem;font:inherit;cursor:pointer';

export function installHudLab(opts: HudLabOptions): HudLab {
  const { renderer, events, root } = opts;
  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.55;
  renderer.cameras.matrix.position.set(0, 0, 5.2);
  renderer.cameras.matrix.lookAt(0, 0, 0);
  renderer.cameras.matrix.updateMatrixWorld();
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();

  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  pass.params.enableBarrel = true;
  pass.params.enableJitter = false;
  pass.params.enableFlicker = false;
  pass.params.enableGrain = true;
  pass.params.enableVignette = true;

  const grid = makeGrid(18, 18, beamColor(Beam.GRID, 0.7));
  const frame = makeRect(12, 7.2, beamColor(Beam.ICE, 0.85));
  renderer.scenes.matrix.add(grid);
  renderer.scenes.matrix.add(frame);

  const stim = new Mesh(
    new PlaneGeometry(2.4, 1.8),
    new MeshBasicMaterial({ color: 0x2a4a38, toneMapped: false }),
  );
  stim.position.set(0, 0, -2);
  renderer.scenes.simstim.add(stim);

  const hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing,
  });
  hud.setPipLink(true);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="hud-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">HUD · M3.2</div>
      <div data-testid="hud-stats" style="color:#6a8aaa;margin:0 0 0.4rem;font-size:11px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-testid="hud-neural-calm" style="${BTN}">neural 0</button>
        <button type="button" data-testid="hud-neural-mid" style="${BTN}">neural 50</button>
        <button type="button" data-testid="hud-neural-high" style="${BTN}">neural 100</button>
        <button type="button" data-testid="hud-flatline" style="${BTN}">flatline</button>
        <button type="button" data-testid="hud-trace-hot" style="${BTN}">trace 92</button>
        <button type="button" data-testid="hud-dixie" style="${BTN}">dixie baud</button>
        <button type="button" data-testid="hud-wintermute" style="${BTN}">WM instant</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="hud-stats"]')!;

  overlay.querySelector('[data-testid="hud-neural-calm"]')!.addEventListener('click', () => {
    hud.setFlatline(false);
    hud.setNeural(0);
  });
  overlay.querySelector('[data-testid="hud-neural-mid"]')!.addEventListener('click', () => {
    hud.setFlatline(false);
    hud.setNeural(50);
  });
  overlay.querySelector('[data-testid="hud-neural-high"]')!.addEventListener('click', () => {
    hud.setFlatline(false);
    hud.setNeural(100);
  });
  overlay.querySelector('[data-testid="hud-flatline"]')!.addEventListener('click', () => {
    hud.setFlatline(true);
  });
  overlay.querySelector('[data-testid="hud-trace-hot"]')!.addEventListener('click', () => {
    hud.setTrace(92);
  });
  overlay.querySelector('[data-testid="hud-dixie"]')!.addEventListener('click', () => {
    hud.print('DIXIE> night city is a cage, Case');
  });
  overlay.querySelector('[data-testid="hud-wintermute"]')!.addEventListener('click', () => {
    hud.print('WINTERMUTE> I NEED A RIDER', { wintermute: true });
  });

  const handle: HudLabHandle = {
    get neural() {
      return hud.state.neural;
    },
    get trace() {
      return hud.state.trace;
    },
    get flatline() {
      return hud.state.flatline;
    },
    get mode() {
      return hud.state.mode;
    },
    get terminalVisible() {
      return hud.terminalVisible;
    },
    get terminalPending() {
      return hud.terminalPending;
    },
    get eegVariance() {
      return hud.eegVariance;
    },
    get layout() {
      return hud.layout;
    },
    get pipLink() {
      return hud.pipLink;
    },
    setNeural: (n) => hud.setNeural(n),
    setTrace: (n) => hud.setTrace(n),
    setFlatline: (on) => hud.setFlatline(on),
    setMode: (mode) => hud.setMode(mode),
    print(text, wintermute) {
      hud.print(text, { wintermute });
    },
    clearTerminal() {
      hud.clearTerminal();
    },
    setPain: (n) => hud.setPain(n),
    setPipLink: (on) => hud.setPipLink(on),
    setTime() {},
    update(dt) {
      hud.update(dt);
    },
  };
  window.__nonspaceHud = handle;
  root.dataset.lab = 'hud';
  root.dataset.terminalCps = String(TERMINAL_CHARS_PER_SEC);

  const sync = (): void => {
    stats.textContent = `neural ${hud.state.neural.toFixed(0)}  trace ${hud.state.trace.toFixed(0)}  eegσ ${hud.eegVariance.toFixed(3)}`;
    root.dataset.neural = String(hud.state.neural);
    root.dataset.trace = String(hud.state.trace);
    root.dataset.flatline = hud.state.flatline ? '1' : '0';
    root.dataset.mode = hud.state.mode;
    root.dataset.terminal = hud.terminalVisible;
  };
  sync();

  return {
    hud,
    update(dt) {
      hud.update(dt);
      sync();
    },
    dispose() {
      overlay.remove();
      hud.dispose();
      renderer.scenes.matrix.remove(grid);
      renderer.scenes.matrix.remove(frame);
      disposeObject(grid);
      disposeObject(frame);
      renderer.scenes.simstim.remove(stim);
      stim.geometry.dispose();
      (stim.material as MeshBasicMaterial).dispose();
      if (window.__nonspaceHud === handle) delete window.__nonspaceHud;
      delete root.dataset.lab;
      delete root.dataset.neural;
      delete root.dataset.trace;
      delete root.dataset.flatline;
      delete root.dataset.mode;
      delete root.dataset.terminal;
      delete root.dataset.terminalCps;
    },
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

function makeGrid(size: number, divs: number, color: Color): LineSegments {
  const verts: number[] = [];
  const h = size * 0.5;
  for (let i = 0; i <= divs; i++) {
    const t = (i / divs) * size - h;
    verts.push(-h, t, 0, h, t, 0);
    verts.push(t, -h, 0, t, h, 0);
  }
  return lines(verts, color);
}

function makeRect(w: number, h: number, color: Color): LineSegments {
  const x = w * 0.5;
  const y = h * 0.5;
  return lines(
    [-x, -y, 0, x, -y, 0, x, -y, 0, x, y, 0, x, y, 0, -x, y, 0, -x, y, 0, -x, -y, 0],
    color,
  );
}

function lines(verts: number[], color: Color): LineSegments {
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
