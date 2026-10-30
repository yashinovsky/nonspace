/**
 * Dev route `?lab=breach` (M4.3). In-matrix Phase Lock, grip countdown,
 * flatline sequence, burned jack-out. Query:
 * `?lab=breach&scene=white|gray|black|approach|grip|flatline|burned`.
 * Lazy-imported from App so the default-boot graph never fetches it.
 */

import { createBreachMode } from '../app/modes/Breach';
import { createFlatlineMode, type FlatlineMode } from '../app/modes/Flatline';
import { createJackOutMode } from '../app/modes/JackOut';
import type { ModeStack } from '../app/ModeStack';
import {
  canEngageFrom,
  createBreachController,
  ENGAGE_RANGE,
  type IceAnchor,
} from '../breach/BreachController';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { createIceModel, type IceDef, type IceModel } from '../breach/IceModel';
import { BLACK_ICE } from '../content/ice/black';
import { GRAY_ICE } from '../content/ice/gray';
import { WHITE_ICE } from '../content/ice/white';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createHud } from '../hud/Hud';
import type { InputService } from '../input/Input';
import { createCameraRig, type CameraRig } from '../player/CameraRig';
import { sphereHull } from '../player/Collision';
import type { FlightController } from '../player/FlightController';
import type { Vec3 } from '../core/math/vec3';
import { asBlackIceComposite } from '../render/post/BlackIceComposite';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';

export const BREACH_SCENES = [
  'white',
  'gray',
  'black',
  'approach',
  'grip',
  'flatline',
  'burned',
] as const;
export type BreachScene = (typeof BREACH_SCENES)[number];

export function isBreachScene(value: string | null): value is BreachScene {
  return (BREACH_SCENES as readonly string[]).includes(value ?? '');
}

const DEFS: Record<'white' | 'gray' | 'black', IceDef> = {
  white: WHITE_ICE,
  gray: GRAY_ICE,
  black: BLACK_ICE,
};

const START = { x: 0, y: 2, z: 40, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 } as const;

export interface BreachLab {
  update(dt: number): void;
  dispose(): void;
}

export interface BreachLabHandle {
  scene: BreachScene;
  engaged: boolean;
  neural: number;
  trace: number;
  gripRemaining: number;
  jackOutBlocked: boolean;
  scars: number;
  knobs: { R: number; Phi: number };
  meter: number;
  m: number;
  flatlinePhase: string;
  burned: boolean;
  canEngage(player: Vec3, forward: Vec3): boolean;
  tryEngage(player: Vec3, forward: Vec3): boolean;
  engage(): void;
  disengage(): void;
  forceGrip(): void;
  forceFlatline(scripted?: boolean): void;
  forceBurned(): void;
  seekFlatline(time: number): void;
  setKnobs(lnR: number, Phi: number): void;
  stepInput(dt: number, patch?: { mouseDx?: number; mouseDy?: number; fine?: boolean }): void;
  advance(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceBreach?: BreachLabHandle;
  }
}

export interface BreachLabOptions {
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  input: InputService;
  flight: FlightController;
  modes: ModeStack;
  root: HTMLElement;
  scene?: string | null;
  reduceFlashing?: () => boolean;
  reduceMotion?: () => boolean;
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

export function installBreachLab(opts: BreachLabOptions): BreachLab {
  const { renderer, events, save, settings, input, flight, modes, root } = opts;
  const rawScene = opts.scene ?? null;
  const startScene: BreachScene = isBreachScene(rawScene) ? rawScene : 'white';

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.6;
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();

  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  pass.params.enableBarrel = true;
  pass.params.enableJitter = false;
  pass.params.enableFlicker = false;
  pass.params.enableGrain = true;
  pass.params.enableVignette = true;

  const hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing ?? (() => settings.value.reduceFlashing),
  });
  hud.setCoords('CHBA 0000.00 / 0000.00 / 0002');
  hud.setSpeed(0);
  hud.setPipLink(false);

  const breach = createBreachController({ events, save });
  breach.neural.reset(12);
  breach.trace.reset(8);
  breach.markCheckpoint();

  const fwd = { x: 0, y: 0, z: -1 };
  const icePos = { x: 0, y: 0, z: 0 };
  let scene = startScene;
  let iceClass: 'white' | 'gray' | 'black' =
    scene === 'gray' ? 'gray' : scene === 'black' || scene === 'grip' ? 'black' : 'white';
  let visuals: IceVisuals | null = null;
  let display: IceModel = createIceModel(DEFS[iceClass], { seed: 1 });
  let flatMode: FlatlineMode | null = null;
  let burned = false;

  const rig: CameraRig = createCameraRig({ camera: renderer.cameras.matrix });
  flight.collision.add(sphereHull('lab-ice', 'ice', 0, 0, 0, 12));
  flight.setPose({ ...START });

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="breach-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">BREACH · M4.3</div>
      <div data-testid="breach-stats" style="color:#c8e4ff;margin:0 0 0.4rem;font-size:11px;white-space:pre"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-testid="breach-engage" style="${BTN}">engage</button>
        <button type="button" data-testid="breach-grip" style="${BTN}">grip</button>
        <button type="button" data-testid="breach-flatline" style="${BTN}">flatline</button>
        <button type="button" data-testid="breach-burn" style="${BTN}">burned</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="breach-stats"]')!;

  const player = (): Vec3 => ({ x: flight.pose.x, y: flight.pose.y, z: flight.pose.z });
  const look = (): Vec3 => flight.forward(fwd);

  const anchor = (): IceAnchor => ({
    def: DEFS[iceClass],
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: iceClass === 'white' ? 1 : iceClass === 'gray' ? 2 : 3,
  });

  const liveModel = (): IceModel => breach.ice ?? display;

  const tickIce = (dt: number, reduceMotion: boolean): void => {
    const vis = visuals;
    if (!vis) return;
    vis.update(dt, liveModel(), renderer.cameras.matrix, reduceMotion);
  };

  const rebuildVisuals = (): void => {
    visuals?.dispose();
    display = createIceModel(DEFS[iceClass], {
      seed: iceClass === 'white' ? 1 : iceClass === 'gray' ? 2 : 3,
    });
    visuals = createIceVisuals({
      renderer,
      def: DEFS[iceClass],
      x: icePos.x,
      y: icePos.y,
      z: icePos.z,
      driveGrip: iceClass === 'black',
    });
  };

  const dropModes = (): void => {
    if (modes.size > 0) modes.reset();
    flatMode = null;
  };

  const paintHud = (): void => {
    hud.setNeural(breach.neural.value);
    hud.setTrace(breach.trace.value);
    hud.setScars(breach.neural.scars);
    hud.setSpeed(flight.telemetry.speed);
    if (breach.grip.active) {
      hud.setMode('GRIP');
      hud.setGrip(breach.grip.remaining);
    } else if (modes.top?.id === 'flatline') {
      hud.setFlatline(true);
      hud.setGrip(null);
      hud.setLock(null);
    } else if (breach.engaged) {
      hud.setMode('BREACH');
      hud.setGrip(null);
    } else {
      hud.setMode('APPROACH');
      hud.setGrip(null);
      hud.setLock(null);
    }
    const cur = breach.ice?.state.current;
    if (cur && breach.engaged) {
      const [a, b] = cur.ratio;
      hud.setLock({
        meter: cur.meter,
        m: cur.m,
        lnR: Math.log(breach.knobs.R),
        targetLnR: Math.log(b / a),
        Phi: breach.knobs.Phi,
        phi: cur.phi,
        telegraph: cur.telegraph !== null,
      });
    }
    hud.update(0);
  };

  const pushBreach = (): void => {
    dropModes();
    modes.push(
      createBreachMode({
        breach,
        hud,
        visuals,
        camera: renderer.cameras.matrix,
        reduceMotion: opts.reduceMotion ?? (() => settings.value.reduceMotion),
        onCracked() {
          dropModes();
          hud.print('LAYER CRACKED');
        },
        onFlatline() {
          startFlatline();
        },
        onBurned() {
          startBurned();
        },
        onJackOut() {
          if (!breach.canJackOut()) return;
          dropModes();
          modes.push(createJackOutMode({ reason: 'player' }));
        },
      }),
    );
  };

  const startFlatline = (): void => {
    dropModes();
    hud.setFlatline(true);
    flatMode = createFlatlineMode({
      breach,
      onDone() {
        flight.setPose({ ...START });
        iceClass = 'white';
        rebuildVisuals();
        dropModes();
        burned = false;
      },
    });
    modes.push(flatMode);
  };

  const startBurned = (): void => {
    burned = true;
    dropModes();
    modes.push(createJackOutMode({ reason: 'burned', emit: false }));
  };

  const doEngage = (): boolean => {
    const ok = breach.tryEngage(player(), look(), anchor());
    if (!ok) return false;
    pushBreach();
    hud.print(`ENGAGE ${anchor().def.id}`);
    return true;
  };

  const applyScene = (next: BreachScene): void => {
    scene = next;
    burned = false;
    dropModes();
    asBlackIceComposite(renderer.chain.getPass('blackIce')).grip = 0;
    if (next === 'gray') iceClass = 'gray';
    else if (next === 'black' || next === 'grip') iceClass = 'black';
    else iceClass = 'white';
    rebuildVisuals();
    flight.setPose({ ...START });
    breach.restoreCheckpoint();
    breach.neural.reset(12);
    breach.trace.reset(8);
    hud.setFlatline(false);
    if (next === 'approach') {
      hud.setMode('APPROACH');
    } else {
      breach.engage(anchor());
      pushBreach();
      if (next === 'grip') {
        breach.neural.set(61);
        if (breach.ice) breach.ice.state.neural = 61;
        breach.forceGrip('neural');
      } else if (next === 'flatline') {
        breach.forceFlatline(false);
        startFlatline();
      } else if (next === 'burned') {
        breach.forceBurned();
        startBurned();
      }
    }
    paintHud();
  };

  overlay.querySelector('[data-testid="breach-engage"]')!.addEventListener('click', () => {
    doEngage();
    paintHud();
  });
  overlay.querySelector('[data-testid="breach-grip"]')!.addEventListener('click', () => {
    applyScene('grip');
  });
  overlay.querySelector('[data-testid="breach-flatline"]')!.addEventListener('click', () => {
    if (!breach.engaged) breach.engage(anchor());
    breach.forceFlatline(false);
    startFlatline();
    paintHud();
  });
  overlay.querySelector('[data-testid="breach-burn"]')!.addEventListener('click', () => {
    breach.forceBurned();
    startBurned();
    paintHud();
  });

  const sync = (): void => {
    const cur = breach.ice?.state.current;
    stats.textContent = [
      `scene ${scene}${breach.engaged ? '  LOCK' : ''}`,
      `neural ${breach.neural.value.toFixed(0)}  trace ${breach.trace.value.toFixed(0)}`,
      `grip ${breach.grip.active ? breach.grip.remaining.toFixed(1) : '—'}  scars ${breach.neural.scars}`,
      `m ${(cur?.m ?? 0).toFixed(2)}  meter ${((cur?.meter ?? 0) * 100).toFixed(0)}%`,
    ].join('\n');
    root.dataset.lab = 'breach';
    root.dataset.scene = scene;
    root.dataset.engaged = breach.engaged ? '1' : '0';
    root.dataset.grip = breach.grip.active ? '1' : '0';
    root.dataset.jackOut = breach.canJackOut() ? '1' : '0';
    root.dataset.neural = String(Math.round(breach.neural.value));
    root.dataset.trace = String(Math.round(breach.trace.value));
    root.dataset.scars = String(breach.neural.scars);
    root.dataset.flatline = modes.has('flatline') ? '1' : '0';
    root.dataset.burned = burned || modes.has('jackOut') ? (burned ? '1' : '0') : '0';
  };

  const stepApproach = (dt: number): void => {
    const frame = input.frame;
    flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
    const out = breach.step(dt, frame, { iceContact: flight.telemetry.iceContact });
    if (out.kind === 'flatline') startFlatline();
    if (out.kind === 'burned') startBurned();
    if (frame.pressed('engage')) doEngage();
    tickIce(dt, opts.reduceMotion?.() ?? false);
  };

  const handle: BreachLabHandle = {
    get scene() {
      return scene;
    },
    get engaged() {
      return breach.engaged;
    },
    get neural() {
      return breach.neural.value;
    },
    get trace() {
      return breach.trace.value;
    },
    get gripRemaining() {
      return breach.grip.remaining;
    },
    get jackOutBlocked() {
      return breach.jackOutBlocked;
    },
    get scars() {
      return breach.neural.scars;
    },
    get knobs() {
      return { R: breach.knobs.R, Phi: breach.knobs.Phi };
    },
    get meter() {
      return breach.ice?.state.current.meter ?? 0;
    },
    get m() {
      return breach.ice?.state.current.m ?? 0;
    },
    get flatlinePhase() {
      return flatMode?.visual.phase ?? 'idle';
    },
    get burned() {
      return burned;
    },
    canEngage(p, f) {
      return canEngageFrom(p, f, icePos, ENGAGE_RANGE);
    },
    tryEngage(p, f) {
      return breach.tryEngage(p, f, anchor());
    },
    engage() {
      doEngage();
      paintHud();
      sync();
    },
    disengage() {
      breach.disengage();
      dropModes();
      paintHud();
      sync();
    },
    forceGrip() {
      // White ICE has no grip layer. Always rebuild black even if already
      // engaged — otherwise IceModel.forceGrip is a silent no-op.
      iceClass = 'black';
      rebuildVisuals();
      breach.engage(anchor());
      pushBreach();
      breach.neural.set(Math.max(breach.neural.value, 61));
      if (breach.ice) breach.ice.state.neural = Math.max(breach.ice.state.neural, 61);
      breach.forceGrip('neural');
      scene = 'grip';
      tickIce(0, true);
      paintHud();
      sync();
    },
    forceFlatline(scripted = false) {
      if (!breach.engaged) breach.engage(anchor());
      breach.forceFlatline(scripted);
      startFlatline();
      paintHud();
      sync();
    },
    forceBurned() {
      breach.forceBurned();
      startBurned();
      paintHud();
      sync();
    },
    seekFlatline(time) {
      if (!flatMode) {
        if (!breach.engaged) breach.engage(anchor());
        breach.forceFlatline(false);
        startFlatline();
      }
      modes.handleInput(input.frame);
      flatMode?.seek(time);
      paintHud();
      sync();
    },
    setKnobs(lnR, Phi) {
      breach.knobs.lnR = lnR;
      breach.knobs.Phi = Phi;
    },
    stepInput(dt, patch) {
      if (patch?.mouseDx) input.feedMouseMove(patch.mouseDx, patch.mouseDy ?? 0);
      const frame = input.sample(dt);
      if (modes.size > 0) {
        modes.handleInput(frame);
        modes.update(dt);
      } else {
        stepApproach(dt);
      }
      paintHud();
      sync();
    },
    advance(dt) {
      const frame = input.sample(dt);
      if (modes.size > 0) {
        modes.handleInput(frame);
        modes.update(dt);
      } else {
        stepApproach(dt);
      }
      rig.apply(flight, 1);
      if (modes.size > 0 && !modes.has('breach')) {
        tickIce(dt, opts.reduceMotion?.() ?? false);
      }
      paintHud();
      sync();
    },
    paint() {
      rig.apply(flight, 1);
      paintHud();
      sync();
    },
  };

  window.__nonspaceBreach = handle;

  applyScene(startScene);
  rig.apply(flight, 1);
  tickIce(0, true);
  paintHud();
  sync();

  return {
    update(dt) {
      if (modes.size === 0) stepApproach(dt);
      else if (!modes.has('breach')) tickIce(dt, opts.reduceMotion?.() ?? false);
      rig.apply(flight, 1);
      paintHud();
      sync();
    },
    dispose() {
      overlay.remove();
      dropModes();
      visuals?.dispose();
      hud.dispose();
      flight.collision.remove('lab-ice');
      asBlackIceComposite(renderer.chain.getPass('blackIce')).grip = 0;
      if (window.__nonspaceBreach === handle) delete window.__nonspaceBreach;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.engaged;
      delete root.dataset.grip;
      delete root.dataset.jackOut;
      delete root.dataset.neural;
      delete root.dataset.trace;
      delete root.dataset.scars;
      delete root.dataset.flatline;
      delete root.dataset.burned;
    },
  };
}
