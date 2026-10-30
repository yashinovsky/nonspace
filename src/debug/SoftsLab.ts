/**
 * Dev route `?lab=phaselock3d` (alias `?lab=softs`) — M4.4 in-matrix breach
 * test. Each soft's effect is live: PROBE numeral, CLAMP drift freeze, DAMPER
 * feedback, DECOY lure stub, MIMIC converge, KUANG crack. Dixie `H` forwards
 * to the M7.2 companion via `SoftsWorld.dixie`. Lazy `?lab=` chunk; default
 * boot never fetches it.
 *
 * Query: `&scene=probe|clamp|damper|decoy|mimic|kuang|dixie|loadout` (or `&soft=`).
 */

import { Vector3 } from 'three';
import {
  createBreachController,
  type BreachKnobs,
  type IceAnchor,
} from '../breach/BreachController';
import type { IceDef, IceModel } from '../breach/IceModel';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { asDixieReadApi, createDixie } from '../companion/Dixie';
import { GRAY_ICE } from '../content/ice/gray';
import { ICE_LAYER_PRESETS } from '../content/ice/presets';
import { DEFAULT_SOFT_SLOTS, getSoft } from '../content/softs';
import type { EventBus } from '../core/events';
import type { Vec3 } from '../core/math/vec3';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createWatcherLureStub } from '../deck/softs/effects';
import {
  createSoftsRuntime,
  DIXIE_READ_ID,
  type SoftsRunState,
  type SoftsWorld,
} from '../deck/softs/registry';
import { createHud } from '../hud/Hud';
import type { SoftSlot } from '../hud/VfdStrip';
import type { InputService } from '../input/Input';
import { createCameraRig, type CameraRig } from '../player/CameraRig';
import type { FlightController } from '../player/FlightController';
import { Beam, BeamFlag, createBeamBatch } from '../render/lines/BeamBatch';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';
import { createVfdText } from '../render/text/VfdText';

export const SOFTS_SCENES = [
  'probe',
  'clamp',
  'damper',
  'decoy',
  'mimic',
  'kuang',
  'dixie',
  'loadout',
] as const;
export type SoftsScene = (typeof SOFTS_SCENES)[number];

export function isSoftsScene(value: string | null | undefined): value is SoftsScene {
  return (SOFTS_SCENES as readonly string[]).includes(value ?? '');
}

/** Lab-only T-A stand-in so KUANG is verifiable before M4.5. */
const TA_LAB_ICE: IceDef = {
  id: 'ta-lab',
  class: 'ta',
  shell: 'slab',
  radius: 14,
  layers: [structuredClone(ICE_LAYER_PRESETS['kuang-gate'])],
  hue: Beam.TA,
};

const START = { x: 0, y: 2, z: 40, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 } as const;
const WATCHER = { x: 18, y: 6, z: 22 };

export interface SoftsLab {
  update(dt: number): void;
  dispose(): void;
}

export interface SoftsLabHandle {
  scene: SoftsScene;
  engaged: boolean;
  neural: number;
  trace: number;
  knobs: { R: number; Phi: number };
  meter: number;
  m: number;
  ratio: readonly [number, number] | null;
  phi: number;
  nextRekeyAt: number | null;
  revealLabel: string | null;
  decoyActive: boolean;
  watcherLured: boolean;
  lure: { x: number; y: number; z: number; remaining: number } | null;
  freezeDrift: boolean;
  feedbackMul: number;
  traceMul: number;
  lastUsed: string | null;
  lastFail: string | null;
  hudSofts: readonly SoftSlot[];
  charges(id: string): number | undefined;
  cooldown(id: string): number;
  use(id: string): boolean;
  useSlot(index: number): boolean;
  askDixie(): boolean;
  snapshot(): SoftsRunState;
  restore(state: SoftsRunState): void;
  setKnobs(lnR: number, Phi: number): void;
  advance(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceSofts?: SoftsLabHandle;
  }
}

export interface SoftsLabOptions {
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  input: InputService;
  flight: FlightController;
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

export function installSoftsLab(opts: SoftsLabOptions): SoftsLab {
  const { renderer, events, save, settings, input, flight, root } = opts;
  const startScene: SoftsScene = isSoftsScene(opts.scene) ? opts.scene : 'probe';

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.55;
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

  const breach = createBreachController({ events, save, settings });
  breach.neural.reset(18);
  breach.trace.reset(12);
  breach.markCheckpoint();

  const softs = createSoftsRuntime({
    slots: DEFAULT_SOFT_SLOTS,
    mimicAlways: settings.value.phaseLock.mimicAlways,
  });
  const unsubMimic = settings.onChange((s) => {
    softs.setMimicAlways(s.phaseLock.mimicAlways);
  });
  softs.unlockAll();
  const watchers = createWatcherLureStub();
  const dixie = createDixie({
    events,
    save,
    aboard: true,
    iceRatio: () => breach.ice?.state.current.ratio ?? null,
  });

  const icePos = { x: 0, y: 0, z: 0 };
  let scene = startScene;
  let iceClass: 'gray' | 'ta' = 'gray';
  let visuals: IceVisuals | null = null;
  let lastUsed: string | null = null;
  let lastFail: string | null = null;

  const rig: CameraRig = createCameraRig({ camera: renderer.cameras.matrix });
  flight.setPose({ ...START });

  const probe = createVfdText(renderer.palette, { capacity: 8, size: 1.7, ghost: true });
  probe.object.name = 'SoftsProbe';
  probe.object.position.set(0, 2.4, 12.4);
  renderer.scenes.matrix.add(probe.object);

  const fx = createBeamBatch(renderer.palette, {
    capacity: 20,
    style: { fogDensity: 0.0002, fogStart: 40, sigma: 0.55, dwell: 0.35 },
  });
  fx.object.name = 'SoftsFx';
  renderer.scenes.matrix.add(fx.object);

  const _a = new Vector3();
  const _b = new Vector3();

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="softs-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">SOFTS · M4.4</div>
      <div data-testid="softs-stats" style="color:#c8e4ff;margin:0 0 0.4rem;font-size:11px;white-space:pre"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-soft="probe" style="${BTN}">1 PROBE</button>
        <button type="button" data-soft="clamp" style="${BTN}">2 CLAMP</button>
        <button type="button" data-soft="damper" style="${BTN}">3 DAMPER</button>
        <button type="button" data-soft="decoy" style="${BTN}">4 DECOY</button>
        <button type="button" data-soft="mimic" style="${BTN}">MIMIC</button>
        <button type="button" data-soft="kuang" style="${BTN}">KUANG</button>
        <button type="button" data-soft="${DIXIE_READ_ID}" style="${BTN}">H DIXIE</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="softs-stats"]')!;

  const player = (): Vec3 => ({ x: flight.pose.x, y: flight.pose.y, z: flight.pose.z });

  const defOf = (): IceDef => (iceClass === 'ta' ? TA_LAB_ICE : GRAY_ICE);

  const anchor = (): IceAnchor => ({
    def: defOf(),
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: iceClass === 'ta' ? 7 : 2,
  });

  const world = (): SoftsWorld => ({
    ice: breach.ice,
    player: player(),
    events,
    lure: watchers,
    dixie: asDixieReadApi(dixie),
  });

  const rebuildVisuals = (): void => {
    visuals?.dispose();
    visuals = createIceVisuals({
      renderer,
      def: defOf(),
      x: icePos.x,
      y: icePos.y,
      z: icePos.z,
    });
  };

  const drawFx = (): void => {
    fx.beginDynamic();
    const decoy = softs.decoy;
    if (decoy) {
      const s = 1.15;
      _a.set(decoy.x - s, decoy.y, decoy.z);
      _b.set(decoy.x + s, decoy.y, decoy.z);
      fx.push(_a, _b, Beam.AMBER, 2.4, 2.2, BeamFlag.DWELL);
      _a.set(decoy.x, decoy.y - s, decoy.z);
      _b.set(decoy.x, decoy.y + s, decoy.z);
      fx.push(_a, _b, Beam.AMBER, 2.4, 2.2, BeamFlag.DWELL);
      _a.set(decoy.x, decoy.y, decoy.z - s);
      _b.set(decoy.x, decoy.y, decoy.z + s);
      fx.push(_a, _b, Beam.AMBER, 2.4, 2.2, BeamFlag.DWELL);
    }
    const aim = decoy && watchers.lured ? decoy : player();
    _a.set(WATCHER.x, WATCHER.y, WATCHER.z);
    const hue = watchers.lured ? Beam.AMBER : Beam.MIL;
    for (let i = -2; i <= 2; i++) {
      _b.set(aim.x + i * 0.55, aim.y + 0.4, aim.z);
      fx.push(_a, _b, hue, watchers.lured ? 2.1 : 1.15, 1.5, BeamFlag.NO_FOG);
    }
    fx.endDynamic();
  };

  const paintHud = (): void => {
    hud.setNeural(breach.neural.value);
    hud.setTrace(breach.trace.value);
    hud.setScars(breach.neural.scars);
    hud.setSpeed(flight.telemetry.speed);
    hud.setMode(breach.engaged ? 'BREACH' : 'APPROACH');
    hud.setGrip(null);
    hud.setSofts(softs.hudSlots);
    const decoy = softs.decoy;
    if (decoy) {
      hud.setBlips([{ angle: Math.atan2(decoy.z, decoy.x), radius: 0.62, kind: 'target' }]);
    } else {
      hud.setBlips([{ angle: 2.2, radius: 0.4, kind: 'ice' }]);
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
    } else {
      hud.setLock(null);
    }
    const label = softs.revealLabel;
    probe.setText(label ?? '', {
      color: Beam.AMBER,
      intensity: 1.35,
      mode: 7,
      align: 'center',
    });
    probe.visible = !!label;
    hud.update(0);
  };

  const afterKnobs = (knobs: BreachKnobs, ice: IceModel, dt: number): void => {
    softs.applyMimic(knobs, ice, dt);
  };

  const tick = (dt: number): void => {
    const frame = input.sample(dt);
    if (breach.ice) breach.ice.state.lockDecayScale = dixie.lockDecayScale;
    dixie.update(dt);
    softs.handleInput((a) => frame.pressed(a), world());
    if (breach.engaged) {
      breach.step(dt, frame, { afterKnobs, iceMods: softs.iceMods });
    }
    softs.step(dt, world());
    if (visuals && breach.ice) {
      visuals.update(
        dt,
        breach.ice,
        renderer.cameras.matrix,
        opts.reduceMotion?.() ?? false,
        opts.reduceFlashing?.() ?? settings.value.reduceFlashing,
      );
    }
    drawFx();
    events.flush();
  };

  const doEngage = (): void => {
    breach.engage(anchor());
    hud.print(`ENGAGE ${anchor().def.id}`);
  };

  const fire = (id: string): boolean => {
    const result = id === DIXIE_READ_ID ? softs.askDixie(world()) : softs.use(id, world());
    if (result.ok) {
      lastUsed = result.softId;
      lastFail = null;
      const def = getSoft(result.softId);
      if (def) hud.print(`SOFT ${def.name}`);
    } else {
      lastFail = result.fail ?? 'fail';
    }
    return result.ok;
  };

  const applyScene = (next: SoftsScene): void => {
    scene = next;
    iceClass = next === 'kuang' ? 'ta' : 'gray';
    rebuildVisuals();
    flight.setPose({ ...START });
    breach.restoreCheckpoint();
    breach.neural.reset(18);
    breach.trace.reset(12);
    softs.beginRun({
      slots: DEFAULT_SOFT_SLOTS,
      mimicAlways: settings.value.phaseLock.mimicAlways,
    });
    softs.unlockAll();
    watchers.setLure(null);
    lastUsed = null;
    lastFail = null;
    hud.setFlatline(false);
    hud.clearTerminal();
    doEngage();
    if (next !== 'loadout') fire(next === 'dixie' ? DIXIE_READ_ID : next);
    paintHud();
  };

  overlay.querySelectorAll('[data-soft]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.soft;
      if (id) fire(id);
      paintHud();
      sync();
    });
  });

  const sync = (): void => {
    const cur = breach.ice?.state.current;
    const decoy = softs.decoy;
    const ratio = cur ? `${cur.ratio[0]}:${cur.ratio[1]}` : '—';
    const hook = lastFail === 'no-companion' ? 'NO-OP' : (lastUsed ?? '—');
    stats.textContent = [
      `scene ${scene}${breach.engaged ? '  LOCK' : ''}  ${ratio}`,
      `slots ${softs.hudSlots.map((s) => s.label).join(' ')}`,
      `probe ${softs.revealLabel ?? '—'}  decoy ${decoy ? decoy.remaining.toFixed(1) : '—'}`,
      `clamp ${softs.iceMods.freezeDrift ? 'ON' : '—'}  damp ${(softs.iceMods.feedbackMul ?? 1).toFixed(2)}`,
      `lure ${watchers.lured ? 'YES' : 'no'}  H ${hook}`,
    ].join('\n');
    root.dataset.lab = 'phaselock3d';
    root.dataset.scene = scene;
    root.dataset.engaged = breach.engaged ? '1' : '0';
    root.dataset.probe = softs.revealLabel ?? '';
    root.dataset.decoy = decoy ? '1' : '0';
    root.dataset.lure = watchers.lured ? '1' : '0';
    root.dataset.dixie = lastFail === 'no-companion' ? 'noop' : '';
  };

  const handle: SoftsLabHandle = {
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
    get knobs() {
      return { R: breach.knobs.R, Phi: breach.knobs.Phi };
    },
    get meter() {
      return breach.ice?.state.current.meter ?? 0;
    },
    get m() {
      return breach.ice?.state.current.m ?? 0;
    },
    get ratio() {
      return breach.ice?.state.current.ratio ?? null;
    },
    get phi() {
      return breach.ice?.state.current.phi ?? 0;
    },
    get nextRekeyAt() {
      return breach.ice?.state.current.nextRekeyAt ?? null;
    },
    get revealLabel() {
      return softs.revealLabel;
    },
    get decoyActive() {
      return softs.decoy !== null;
    },
    get watcherLured() {
      return watchers.lured;
    },
    get lure() {
      const d = softs.decoy;
      return d ? { x: d.x, y: d.y, z: d.z, remaining: d.remaining } : null;
    },
    get freezeDrift() {
      return !!softs.iceMods.freezeDrift;
    },
    get feedbackMul() {
      return softs.iceMods.feedbackMul ?? 1;
    },
    get traceMul() {
      return softs.iceMods.traceMul ?? 1;
    },
    get lastUsed() {
      return lastUsed;
    },
    get lastFail() {
      return lastFail;
    },
    get hudSofts() {
      return softs.hudSlots;
    },
    charges(id) {
      return softs.chargesLeft(id);
    },
    cooldown(id) {
      return softs.cooldownLeft(id);
    },
    use(id) {
      const ok = fire(id);
      paintHud();
      sync();
      return ok;
    },
    useSlot(index) {
      const result = softs.useSlot(index, world());
      lastUsed = result.ok ? result.softId : lastUsed;
      lastFail = result.ok ? null : (result.fail ?? 'fail');
      paintHud();
      sync();
      return result.ok;
    },
    askDixie() {
      return handle.use(DIXIE_READ_ID);
    },
    snapshot() {
      return softs.snapshot();
    },
    restore(state) {
      softs.restore(state);
      paintHud();
      sync();
    },
    setKnobs(lnR, Phi) {
      breach.knobs.lnR = lnR;
      breach.knobs.Phi = Phi;
    },
    advance(dt) {
      tick(dt);
      rig.apply(flight, 1);
      paintHud();
      sync();
    },
    paint() {
      rig.apply(flight, 1);
      if (visuals && breach.ice) {
        visuals.update(
          0,
          breach.ice,
          renderer.cameras.matrix,
          true,
          opts.reduceFlashing?.() ?? settings.value.reduceFlashing,
        );
      }
      drawFx();
      paintHud();
      sync();
    },
  };

  window.__nonspaceSofts = handle;
  applyScene(startScene);
  handle.paint();

  return {
    update(dt) {
      tick(dt);
      rig.apply(flight, 1);
      paintHud();
      sync();
    },
    dispose() {
      unsubMimic();
      overlay.remove();
      dixie.dispose();
      visuals?.dispose();
      hud.dispose();
      probe.dispose();
      fx.dispose();
      renderer.scenes.matrix.remove(probe.object);
      renderer.scenes.matrix.remove(fx.object);
      if (window.__nonspaceSofts === handle) delete window.__nonspaceSofts;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.engaged;
      delete root.dataset.probe;
      delete root.dataset.decoy;
      delete root.dataset.lure;
      delete root.dataset.dixie;
    },
  };
}
