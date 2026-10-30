/**
 * Dev route `?lab=dixie` (M7.2). Dixie companion: event barks, H-read,
 * auto-hold during simstim, flatline commentary, erase prompt.
 * Voice + VFD/terminal on the 1984 vector CRT HUD — not a neon portrait.
 * Lazy `?lab=` chunk; default boot never fetches it.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  type Object3D,
} from 'three';
import { createIceModel, type IceDef, type IceModel } from '../breach/IceModel';
import { ERASE_LICENSE_LABEL, ERASE_PROMPT, createDixie, type Dixie } from '../companion/Dixie';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import { createHud } from '../hud/Hud';
import type { InputService } from '../input/Input';
import { BEAM_HEX } from '../render/palette';
import { Beam } from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';

/** Pinned 3:2 so `H` always reads "that's a three-two, kid". */
export const DIXIE_LAB_ICE: IceDef = {
  id: 'dixie-lab',
  class: 'white',
  shell: 'cube',
  radius: 12,
  layers: [
    {
      ratios: [[3, 2]],
      tolRatio: 0.1,
      phaseDrift: 0,
      telegraph: 0,
      lockTime: 2,
      traceRate: 0,
      feedbackDps: 0,
    },
  ],
  hue: Beam.ICE,
};

export interface DixieLab {
  update(dt: number): void;
  dispose(): void;
}

export interface DixieLabHandle {
  lastLine: string;
  lastLineId: string;
  speaking: boolean;
  terminalVisible: string;
  meter: number;
  lockDecayScale: number;
  autoHold: boolean;
  flipped: boolean;
  reading: number;
  readCooldown: number;
  erasePrompt: boolean;
  erased: boolean | null;
  heardFlatlines: number;
  askRead(): boolean;
  setFlipped(on: boolean): void;
  setAutoHold(on: boolean): void;
  toggleAutoHold(): boolean;
  setMeter(v: number): void;
  /** Far-off knobs so the meter drains (m below lock threshold). */
  mismatchKnobs(): void;
  startErase(): void;
  answerErase(yes: boolean): boolean;
  forceFlatline(scripted?: boolean): void;
  advance(dt: number): void;
  /** One HUD+ICE paint with `dt` (e2e uses 0 after freezing rAF). */
  update(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceDixie?: DixieLabHandle;
  }
}

export interface DixieLabOptions {
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  input: InputService;
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

export function installDixieLab(opts: DixieLabOptions): DixieLab {
  const { renderer, events, save, input, root } = opts;
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

  const hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing,
  });
  hud.setCoords('CHBA 0000.00 / 0000.00 / 0002');
  hud.setMode('BREACH');
  hud.setSpeed(0);
  hud.setPipLink(false);
  hud.clearTerminal();

  const ice: IceModel = createIceModel(DIXIE_LAB_ICE, { seed: 1, events });
  const knobs = { R: 0.25, Phi: 0 };

  const dixie: Dixie = createDixie({
    events,
    save,
    aboard: true,
    iceRatio: () => (ice.state.status === 'engaged' ? ice.state.current.ratio : null),
    onDeckPrompt: (text) => {
      // System Y/N line — instant, not 1200-baud Dixie speech.
      hud.print(text, { wintermute: true });
    },
  });

  ice.engage();
  ice.state.current.meter = 0.62;
  events.flush();
  dixie.update(0);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="dixie-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">DIXIE · M7.2</div>
      <div data-testid="dixie-stats" style="color:#c8e4ff;margin:0 0 0.4rem;font-size:11px;white-space:pre"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-testid="dixie-read" style="${BTN}">H read</button>
        <button type="button" data-testid="dixie-flip" style="${BTN}">flip</button>
        <button type="button" data-testid="dixie-hold" style="${BTN}">auto-hold</button>
        <button type="button" data-testid="dixie-flatline" style="${BTN}">flatline</button>
        <button type="button" data-testid="dixie-erase" style="${BTN}">erase</button>
        <button type="button" data-testid="dixie-erase-y" style="${BTN}">Y</button>
        <button type="button" data-testid="dixie-erase-n" style="${BTN}">N</button>
      </div>
      <div data-testid="dixie-license" style="color:#6a8aaa;margin-top:0.45rem;font-size:10px;letter-spacing:0.04em">
        ${ERASE_PROMPT} — ${ERASE_LICENSE_LABEL}
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="dixie-stats"]')!;

  const paintHud = (): void => {
    ice.state.lockDecayScale = dixie.lockDecayScale;
    const cur = ice.state.current;
    const [a, b] = cur.ratio;
    hud.setLock({
      meter: cur.meter,
      m: cur.m,
      lnR: Math.log(knobs.R),
      targetLnR: Math.log(b / a),
      Phi: knobs.Phi,
      phi: cur.phi,
      telegraph: cur.telegraph !== null,
    });
    hud.setPipLink(dixie.flipped);
    hud.setMode(dixie.flipped ? 'SIMSTIM' : 'BREACH');
    hud.update(0);
  };

  const tick = (dt: number): void => {
    ice.state.lockDecayScale = dixie.lockDecayScale;
    if (ice.state.status === 'engaged') ice.step(dt, knobs);
    dixie.update(dt);
    events.flush();
    paintHud();
  };

  const sync = (): void => {
    stats.textContent = [
      `line ${dixie.lastLine || '—'}`,
      `meter ${(ice.state.current.meter * 100).toFixed(0)}%  hold ${dixie.lockDecayScale.toFixed(2)}`,
      `flip ${dixie.flipped ? '1' : '0'}  auto ${dixie.autoHold ? '1' : '0'}`,
      `read ${dixie.reading.toFixed(1)}s  cd ${dixie.readCooldown.toFixed(1)}s`,
    ].join('\n');
    root.dataset.lab = 'dixie';
    root.dataset.meter = ice.state.current.meter.toFixed(3);
    root.dataset.hold = dixie.lockDecayScale.toFixed(2);
    root.dataset.flip = dixie.flipped ? '1' : '0';
    root.dataset.auto = dixie.autoHold ? '1' : '0';
    root.dataset.line = dixie.lastLine;
    root.dataset.erase = dixie.erasePrompt ? '1' : '0';
    root.dataset.erased = dixie.erased == null ? '' : dixie.erased ? '1' : '0';
    root.dataset.license = ERASE_LICENSE_LABEL;
  };

  overlay.querySelector('[data-testid="dixie-read"]')!.addEventListener('click', () => {
    dixie.askRead();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-flip"]')!.addEventListener('click', () => {
    const on = !dixie.flipped;
    events.emit({ type: 'simstimFlip', on });
    events.flush();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-hold"]')!.addEventListener('click', () => {
    dixie.toggleAutoHold();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-flatline"]')!.addEventListener('click', () => {
    events.emit({ type: 'flatline', scripted: false });
    events.flush();
    hud.setFlatline(true);
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-erase"]')!.addEventListener('click', () => {
    dixie.startErase();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-erase-y"]')!.addEventListener('click', () => {
    dixie.answerErase(true);
    events.flush();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="dixie-erase-n"]')!.addEventListener('click', () => {
    dixie.answerErase(false);
    events.flush();
    paintHud();
    sync();
  });

  const handle: DixieLabHandle = {
    get lastLine() {
      return dixie.lastLine;
    },
    get lastLineId() {
      return dixie.lastLineId;
    },
    get speaking() {
      return dixie.speaking;
    },
    get terminalVisible() {
      return hud.terminalVisible;
    },
    get meter() {
      return ice.state.current.meter;
    },
    get lockDecayScale() {
      return dixie.lockDecayScale;
    },
    get autoHold() {
      return dixie.autoHold;
    },
    get flipped() {
      return dixie.flipped;
    },
    get reading() {
      return dixie.reading;
    },
    get readCooldown() {
      return dixie.readCooldown;
    },
    get erasePrompt() {
      return dixie.erasePrompt;
    },
    get erased() {
      return dixie.erased;
    },
    get heardFlatlines() {
      return dixie.heardFlatlines;
    },
    askRead() {
      const ok = dixie.askRead();
      sync();
      return ok;
    },
    setFlipped(on) {
      events.emit({ type: 'simstimFlip', on });
      events.flush();
      paintHud();
      sync();
    },
    setAutoHold(on) {
      dixie.setAutoHold(on);
      paintHud();
      sync();
    },
    toggleAutoHold() {
      const on = dixie.toggleAutoHold();
      paintHud();
      sync();
      return on;
    },
    setMeter(v) {
      ice.state.current.meter = v < 0 ? 0 : v > 1 ? 1 : v;
      paintHud();
      sync();
    },
    mismatchKnobs() {
      knobs.R = 0.25;
      knobs.Phi = 0;
    },
    startErase() {
      dixie.startErase();
      paintHud();
      sync();
    },
    answerErase(yes) {
      const ok = dixie.answerErase(yes);
      events.flush();
      paintHud();
      sync();
      return ok;
    },
    forceFlatline(scripted = false) {
      events.emit({ type: 'flatline', scripted });
      events.flush();
      hud.setFlatline(true);
      paintHud();
      sync();
    },
    advance(dt) {
      tick(dt);
      sync();
    },
    update(dt) {
      tick(dt);
      sync();
    },
    paint() {
      paintHud();
      sync();
    },
  };

  window.__nonspaceDixie = handle;
  tick(0);
  // One-shot baud flush so freeze-frame screenshots show the ice-engaged line.
  hud.update(0.5);
  paintHud();
  sync();

  return {
    update(dt) {
      const frame = input.frame;
      if (frame.pressed('askDixie')) dixie.askRead();
      tick(dt);
      sync();
    },
    dispose() {
      overlay.remove();
      dixie.dispose();
      hud.dispose();
      renderer.scenes.matrix.remove(grid);
      renderer.scenes.matrix.remove(frame);
      disposeObject(grid);
      disposeObject(frame);
      if (window.__nonspaceDixie === handle) delete window.__nonspaceDixie;
      delete root.dataset.lab;
      delete root.dataset.meter;
      delete root.dataset.hold;
      delete root.dataset.flip;
      delete root.dataset.auto;
      delete root.dataset.line;
      delete root.dataset.erase;
      delete root.dataset.erased;
      delete root.dataset.license;
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
