/**
 * Dev route `?lab=ai` (M7.3). Wintermute / Neuromancer behaviors on a grid
 * + HUD. Lazy `?lab=` chunk; default boot never fetches it.
 */

import { WHITE_ICE } from '../content/ice/white';
import { createIceModel, type IceModel } from '../breach/IceModel';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import { createHud, type Hud } from '../hud/Hud';
import {
  createWintermute,
  corridorBend,
  type Wintermute,
  type WintermuteAction,
} from '../ai/Wintermute';
import { createNeuromancer, type Neuromancer, type NeuromancerAction } from '../ai/Neuromancer';
import { createPersona, type Persona } from '../ai/Persona';
import type { ModeStack } from '../app/ModeStack';
import { createBeachMode } from '../app/modes/Beach';
import type { CameraRig } from '../player/CameraRig';
import type { FlightController } from '../player/FlightController';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import { createGroundGrid, warpXZ, type GroundGrid } from '../render/grid/GroundGrid';
import { createLocalLattice } from '../render/grid/LocalLattice';
import type { Renderer } from '../render/Renderer';
import { bloomRadiusForWintermute } from '../render/post/BloomPass';

export const AI_SCENES = [
  'overexpose',
  'persona',
  'hijack',
  'freeze',
  'bend',
  'soften',
  'pull',
  'beach',
] as const;
export type AiScene = (typeof AI_SCENES)[number];

export function isAiScene(value: string | null): value is AiScene {
  return (AI_SCENES as readonly string[]).includes(value ?? '');
}

export interface AiPresence {
  readonly wintermute: Wintermute;
  readonly neuromancer: Neuromancer;
  applyWintermute(action: WintermuteAction): void;
  applyNeuromancer(action: NeuromancerAction): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export interface AiPresenceOptions {
  renderer: Renderer;
  flight: FlightController;
  save: SaveStore;
  events: EventBus;
  modes: ModeStack;
  grid?: GroundGrid;
  ice?: IceModel;
  hud?: Hud;
  persona?: Persona;
}

export function createAiPresence(opts: AiPresenceOptions): AiPresence {
  const wintermute = createWintermute({
    palette: opts.renderer.palette,
    renderer: opts.renderer,
    save: opts.save,
    grid: opts.grid,
    ice: opts.ice,
    hud: opts.hud,
    persona: opts.persona,
  });
  const neuromancer = createNeuromancer({
    palette: opts.renderer.palette,
    flight: opts.flight,
    forceBeach: () => {
      if (!opts.modes.has('beach')) opts.modes.reset(createBeachMode());
    },
  });
  return {
    wintermute,
    neuromancer,
    applyWintermute(action) {
      wintermute.apply(action);
    },
    applyNeuromancer(action) {
      neuromancer.apply(action);
    },
    update(dt) {
      wintermute.update(dt);
      neuromancer.update(dt);
    },
    reset() {
      wintermute.reset();
      neuromancer.reset();
    },
    dispose() {
      wintermute.dispose();
      neuromancer.dispose();
    },
  };
}

export interface AiLabHandle {
  scene: string;
  overexpose: number;
  soften: number;
  frozen: boolean;
  hijackText: string;
  personaWho: string | null;
  bloomRadius: number;
  warpOn: boolean;
  warpDelta: number;
  jackOutBlocked: boolean;
  debt: number;
  phonesOn: boolean;
  beachQueued: boolean;
  applyWintermute(action: WintermuteAction): void;
  applyNeuromancer(action: NeuromancerAction): void;
  setScene(scene: AiScene): void;
  reset(): void;
  setTime(t: number): void;
  update(dt: number): void;
}

export interface AiLab {
  update(dt: number): void;
  dispose(): void;
}

export interface AiLabOptions {
  renderer: Renderer;
  flight: FlightController;
  cameraRig: CameraRig;
  events: EventBus;
  save: SaveStore;
  modes: ModeStack;
  root: HTMLElement;
  scene?: string | null;
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

const SAMPLE = { x: 80, z: 0 };

function makeCage(palette: Renderer['palette']): BeamBatchGpu {
  const batch = createBeamBatch(palette, { capacity: 24 });
  const set = createLineSet(12, { width: true, flags: true });
  const e = 18;
  const y0 = 6;
  const y1 = 28;
  const corners: Array<[number, number, number]> = [
    [-e, y0, -e],
    [e, y0, -e],
    [e, y0, e],
    [-e, y0, e],
    [-e, y1, -e],
    [e, y1, -e],
    [e, y1, e],
    [-e, y1, e],
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
  for (let i = 0; i < 12; i++) {
    const [ia, ib] = edges[i]!;
    const a = corners[ia]!;
    const b = corners[ib]!;
    const o = i * 6;
    set.positions[o] = a[0]!;
    set.positions[o + 1] = a[1]!;
    set.positions[o + 2] = a[2]!;
    set.positions[o + 3] = b[0]!;
    set.positions[o + 4] = b[1]!;
    set.positions[o + 5] = b[2]!;
    set.color[i] = Beam.GRID;
    set.intensity[i] = 1.15;
    set.width![i] = 1.6;
    set.flags![i] = BeamFlag.DWELL;
  }
  batch.setStatic(set);
  batch.object.name = 'AiCage';
  return batch;
}

declare global {
  interface Window {
    __nonspaceAi?: AiLabHandle;
  }
}

export function installAiLab(opts: AiLabOptions): AiLab {
  const { renderer, flight, cameraRig, events, save, modes, root } = opts;
  renderer.postMode = 'matrix';
  renderer.vectorLoad = 0.45;
  renderer.cameras.matrix.near = 0.5;
  renderer.cameras.matrix.far = 60_000;
  renderer.cameras.matrix.updateProjectionMatrix();
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();

  const grid = createGroundGrid(renderer.palette);
  const lattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  const cage = makeCage(renderer.palette);
  const persona = createPersona(renderer.palette);
  persona.setPose(0, 16, 8, 10);
  const hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing,
  });
  const ice = createIceModel(WHITE_ICE, { seed: 7, events });
  ice.engage();

  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);
  renderer.scenes.matrix.add(cage.object);
  renderer.scenes.matrix.add(persona.object);

  const presence = createAiPresence({
    renderer,
    flight,
    save,
    events,
    modes,
    grid,
    ice,
    hud,
    persona,
  });

  flight.setPose({
    x: 0,
    y: 18,
    z: 52,
    yaw: 0,
    pitch: -0.12,
    vx: 0,
    vy: 0,
    vz: 0,
    bank: 0,
    fov: flight.params.fovBase,
  });
  cameraRig.apply(flight, 1);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="ai-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">AI · M7.3</div>
      <div data-testid="ai-stats" style="color:#6a8aaa;margin:0 0 0.4rem;font-size:11px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem" data-testid="ai-actions">
        <button type="button" data-testid="ai-overexpose" style="${BTN}">overexpose</button>
        <button type="button" data-testid="ai-persona" style="${BTN}">persona</button>
        <button type="button" data-testid="ai-hijack" style="${BTN}">hijack</button>
        <button type="button" data-testid="ai-freeze" style="${BTN}">freeze</button>
        <button type="button" data-testid="ai-bend" style="${BTN}">grid bend</button>
        <button type="button" data-testid="ai-soften" style="${BTN}">soften</button>
        <button type="button" data-testid="ai-pull" style="${BTN}">pull</button>
        <button type="button" data-testid="ai-phones" style="${BTN}">phones</button>
        <button type="button" data-testid="ai-bargain" style="${BTN}">bargain</button>
        <button type="button" data-testid="ai-beach" style="${BTN}">beach</button>
        <button type="button" data-testid="ai-reset" style="${BTN}">reset</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="ai-stats"]')!;

  let scene: AiScene = isAiScene(opts.scene ?? null) ? (opts.scene as AiScene) : 'overexpose';
  let time = 0;
  let icePhi = ice.state.current.phi;

  const fireWm = (action: WintermuteAction): void => {
    presence.applyWintermute(action);
    events.post({ type: 'wintermute', action });
  };
  const fireNm = (action: NeuromancerAction): void => {
    presence.applyNeuromancer(action);
    events.post({ type: 'neuromancer', action });
  };

  const applyScene = (next: AiScene): void => {
    scene = next;
    presence.reset();
    ice.setFrozen(false);
    icePhi = ice.state.current.phi;
    if (next === 'overexpose') {
      fireWm({ kind: 'overexpose', amount: 1 });
      fireWm({ kind: 'persona', who: 'finn', on: true });
    } else if (next === 'persona') {
      fireWm({ kind: 'persona', who: 'finn', on: true });
    } else if (next === 'hijack') {
      fireWm({ kind: 'hijack', text: 'WINTERMUTE> I NEED A RIDER' });
    } else if (next === 'freeze') {
      fireWm({ kind: 'freeze', on: true });
    } else if (next === 'bend') {
      fireWm({ kind: 'gridBend', points: corridorBend(0.8) });
    } else if (next === 'soften') {
      fireNm({ kind: 'soften', amount: 1 });
    } else if (next === 'pull') {
      fireNm({ kind: 'pull', target: { x: 0, y: 16, z: 8 }, strength: 40 });
    } else if (next === 'beach') {
      fireNm({ kind: 'beach' });
    }
    root.dataset.scene = scene;
  };

  overlay.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).dataset.testid;
    if (id === 'ai-overexpose') {
      const on = presence.wintermute.overexpose < 0.5;
      fireWm({ kind: 'overexpose', amount: on ? 1 : 0 });
    } else if (id === 'ai-persona') {
      const on = !presence.wintermute.personaWho;
      fireWm({ kind: 'persona', who: 'finn', on });
    } else if (id === 'ai-hijack') {
      fireWm({ kind: 'hijack', text: 'WINTERMUTE> I NEED A RIDER' });
    } else if (id === 'ai-freeze') {
      fireWm({ kind: 'freeze', on: !presence.wintermute.frozen });
    } else if (id === 'ai-bend') {
      fireWm(
        presence.wintermute.warpOn
          ? { kind: 'gridBend', points: [] }
          : { kind: 'gridBend', points: corridorBend(0.8) },
      );
    } else if (id === 'ai-soften') {
      const on = presence.neuromancer.soften < 0.5;
      fireNm({ kind: 'soften', amount: on ? 1 : 0 });
    } else if (id === 'ai-pull') {
      const on = presence.neuromancer.pullStrength < 1;
      fireNm(
        on
          ? { kind: 'pull', target: { x: 0, y: 16, z: 8 }, strength: 40 }
          : { kind: 'pull', target: null, strength: 0 },
      );
    } else if (id === 'ai-phones') {
      fireWm({ kind: 'ringPhones', on: !presence.wintermute.phonesOn });
    } else if (id === 'ai-bargain') {
      fireWm({ kind: 'bargain', offerId: 'opens-the-door', debt: 1 });
    } else if (id === 'ai-beach') {
      fireNm({ kind: 'beach' });
    } else if (id === 'ai-reset') {
      presence.reset();
    }
  });

  const warpDelta = (): number => {
    const pts = grid.getWarp();
    const bent = warpXZ(SAMPLE.x, SAMPLE.z, pts);
    return Math.hypot(bent.x - SAMPLE.x, bent.z - SAMPLE.z);
  };

  const sync = (): void => {
    const w = presence.wintermute;
    const n = presence.neuromancer;
    const br = renderer.bloomRadius ?? 1;
    stats.textContent = `over ${w.overexpose.toFixed(2)}  soften ${n.soften.toFixed(2)}  bloom×${br.toFixed(1)}`;
    root.dataset.lab = 'ai';
    root.dataset.scene = scene;
    root.dataset.overexpose = w.overexpose.toFixed(3);
    root.dataset.soften = n.soften.toFixed(3);
    root.dataset.frozen = w.frozen ? '1' : '0';
    root.dataset.hijack = w.hijackText || hud.hijackText;
    root.dataset.persona = w.personaWho ?? '';
    root.dataset.bloomRadius = String(br);
    root.dataset.exposure = renderer.exposure.toFixed(3);
    root.dataset.warp = w.warpOn ? '1' : '0';
    root.dataset.warpDelta = String(warpDelta());
    root.dataset.jackOut = n.jackOutBlocked ? '0' : '1';
    root.dataset.debt = String(w.debt);
    root.dataset.phones = w.phonesOn ? '1' : '0';
    root.dataset.icePhi = ice.state.current.phi.toFixed(5);
    root.dataset.icePhi0 = icePhi.toFixed(5);
    root.dataset.bloomExpected = String(bloomRadiusForWintermute(w.overexpose));
  };

  const handle: AiLabHandle = {
    get scene() {
      return scene;
    },
    get overexpose() {
      return presence.wintermute.overexpose;
    },
    get soften() {
      return presence.neuromancer.soften;
    },
    get frozen() {
      return presence.wintermute.frozen;
    },
    get hijackText() {
      return presence.wintermute.hijackText || hud.hijackText;
    },
    get personaWho() {
      return presence.wintermute.personaWho;
    },
    get bloomRadius() {
      return renderer.bloomRadius ?? 1;
    },
    get warpOn() {
      return presence.wintermute.warpOn;
    },
    get warpDelta() {
      return warpDelta();
    },
    get jackOutBlocked() {
      return presence.neuromancer.jackOutBlocked;
    },
    get debt() {
      return presence.wintermute.debt;
    },
    get phonesOn() {
      return presence.wintermute.phonesOn;
    },
    get beachQueued() {
      return presence.neuromancer.beachQueued;
    },
    applyWintermute: fireWm,
    applyNeuromancer: fireNm,
    setScene(next) {
      applyScene(next);
      sync();
    },
    reset() {
      presence.reset();
      ice.setFrozen(false);
      sync();
    },
    setTime(t) {
      time = t;
      persona.update(t);
      hud.update(0);
      presence.update(0);
    },
    update(dt) {
      time += Math.max(0, dt);
      presence.update(dt);
      if (!presence.wintermute.frozen) ice.step(dt, { R: 1, Phi: 0 });
      persona.update(time);
      hud.update(dt);
      lattice.update(renderer.cameras.matrix.position);
      grid.follow(renderer.cameras.matrix.position);
      cameraRig.apply(flight, 1);
      sync();
    },
  };

  window.__nonspaceAi = handle;
  applyScene(scene);
  handle.update(0);
  hud.update(0);

  return {
    update(dt) {
      handle.update(dt);
    },
    dispose() {
      overlay.remove();
      presence.dispose();
      hud.dispose();
      persona.dispose();
      cage.dispose();
      lattice.dispose();
      grid.dispose();
      renderer.scenes.matrix.remove(grid.object);
      renderer.scenes.matrix.remove(lattice.object);
      renderer.scenes.matrix.remove(cage.object);
      renderer.scenes.matrix.remove(persona.object);
      if (window.__nonspaceAi === handle) delete window.__nonspaceAi;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.overexpose;
      delete root.dataset.soften;
    },
  };
}
