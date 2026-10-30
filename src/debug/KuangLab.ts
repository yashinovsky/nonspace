/**
 * Dev route `?lab=kuang` (M7.8). Kuang rib-body + mimicry, Tempest tube dive,
 * segment gates with kuang-gate Phase Lock. Query:
 * `?lab=kuang&scene=deploy|dive|gate` (alias `?lab=dive`).
 * Lazy-imported from App so the default-boot graph never fetches it.
 */

import { createDiveMode, type DiveMode } from '../app/modes/Dive';
import type { ModeStack } from '../app/ModeStack';
import {
  createNoopAudioEngine,
  type AudioEngine,
  type MusicState,
  type SfxId,
} from '../audio/AudioEngine';
import type { EventBus } from '../core/events';
import type { SettingsStore } from '../core/settings';
import { createHud } from '../hud/Hud';
import type { InputService } from '../input/Input';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import type { PersistencePass } from '../render/post/PersistencePass';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import { createDiveTube, type DiveTube } from '../world/DiveTube';
import {
  createDiveState,
  DIVE_LANES_DEFAULT,
  DIVE_SPEED,
  DIVE_TUBE_RADIUS,
  KUANG_GATE_TOL,
  stepLane,
  type DivePhase,
  type DiveState,
} from '../world/diveMath';
import { createKuang, KUANG_MIMIC_S, type Kuang } from '../world/Kuang';

export const KUANG_SCENES = ['deploy', 'dive', 'gate'] as const;
export type KuangScene = (typeof KUANG_SCENES)[number];

export function isKuangScene(value: string | null | undefined): value is KuangScene {
  return (KUANG_SCENES as readonly string[]).includes(value ?? '');
}

export interface KuangLab {
  update(dt: number): void;
  dispose(): void;
}

export interface KuangLabHandle {
  scene: KuangScene;
  mimic: number;
  reveal: number;
  lane: number;
  lanes: number;
  z: number;
  speed: number;
  phase: DivePhase;
  segment: number;
  hits: number;
  meter: number;
  m: number;
  knobs: { R: number; Phi: number };
  musicState: MusicState;
  lastSfx: SfxId | null;
  tolRatio: number;
  setScene(scene: KuangScene): void;
  setTime(t: number): void;
  setMimic(v: number): void;
  setLane(lane: number): void;
  stepLane(dir: number): void;
  enterGate(): void;
  crackGate(): void;
  advance(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceKuang?: KuangLabHandle;
  }
}

export interface KuangLabOptions {
  renderer: Renderer;
  events: EventBus;
  settings: SettingsStore;
  input: InputService;
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

const DEPLOY_CAM = { x: 11.5, y: 5.2, z: 16.5 } as const;

function buildTaSlabs(renderer: Renderer): BeamBatchGpu {
  const rects = [
    { sx: 22, sy: 10, z: -26, i: 1.15 },
    { sx: 16, sy: 7, z: -24, i: 1.45 },
    { sx: 10, sy: 4.5, z: -22, i: 1.8 },
    { sx: 26, sy: 3.2, z: -28, i: 0.7 },
  ];
  const set = createLineSet(rects.length * 4, { width: true, flags: true });
  let n = 0;
  for (const r of rects) {
    const pts = [
      [-r.sx, -r.sy, r.z],
      [r.sx, -r.sy, r.z],
      [r.sx, r.sy, r.z],
      [-r.sx, r.sy, r.z],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % 4]!;
      const p = n * 6;
      set.positions[p] = a[0];
      set.positions[p + 1] = a[1];
      set.positions[p + 2] = a[2];
      set.positions[p + 3] = b[0];
      set.positions[p + 4] = b[1];
      set.positions[p + 5] = b[2];
      set.color[n] = Beam.TA;
      set.intensity[n] = r.i;
      set.width![n] = 1.6;
      set.flags![n] = BeamFlag.DWELL | BeamFlag.NO_FOG;
      n++;
    }
  }
  const batch = createBeamBatch(renderer.palette, { capacity: 4 });
  batch.object.name = 'TaSlabs';
  batch.setStatic(set);
  renderer.scenes.matrix.add(batch.object);
  return batch;
}

function wrapAudio(inner: AudioEngine): {
  engine: AudioEngine;
  musicState: { value: MusicState };
  lastSfx: { value: SfxId | null };
} {
  const musicState = { value: 'silent' as MusicState };
  const lastSfx = { value: null as SfxId | null };
  const engine: AudioEngine = {
    ...inner,
    sfx(id, opts) {
      lastSfx.value = id;
      inner.sfx(id, opts);
    },
    music: {
      setState(s) {
        musicState.value = s;
        inner.music.setState(s);
      },
      setTempo: inner.music.setTempo.bind(inner.music),
      setKey: inner.music.setKey.bind(inner.music),
    },
  };
  return { engine, musicState, lastSfx };
}

export function installKuangLab(opts: KuangLabOptions): KuangLab {
  const { renderer, events, settings, input, modes, root } = opts;
  const raw = opts.scene ?? null;
  const startScene: KuangScene = isKuangScene(raw) ? raw : 'deploy';

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.45;
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();

  const cam = renderer.cameras.matrix;
  const saved = {
    x: cam.position.x,
    y: cam.position.y,
    z: cam.position.z,
    near: cam.near,
    far: cam.far,
  };

  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  pass.params.enableBarrel = true;
  pass.params.enableJitter = false;
  pass.params.enableFlicker = false;
  pass.params.enableGrain = true;
  pass.params.enableVignette = true;
  const persist = renderer.chain.getPass('persistence') as PersistencePass;
  persist.decayScale = 3;

  const hud = createHud({
    renderer,
    events,
    reduceFlashing: opts.reduceFlashing ?? (() => settings.value.reduceFlashing),
  });
  hud.setCoords('ORBT 0000.00 / 0000.00 / 4800');
  hud.setSpeed(0);
  hud.setPipLink(false);
  hud.setMode('DIVE');

  const { engine: audio, musicState, lastSfx } = wrapAudio(createNoopAudioEngine());
  const slabs = buildTaSlabs(renderer);
  let kuang: Kuang = createKuang({ renderer, pose: 'deploy', mimic: 0, reveal: 1 });
  let state: DiveState = createDiveState({ lanes: DIVE_LANES_DEFAULT, seed: 1 });
  let tube: DiveTube | null = null;
  let dive: DiveMode | null = null;
  let scene: KuangScene = startScene;

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="kuang-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">KUANG · M7.8</div>
      <div data-testid="kuang-stats" style="color:#c8e4ff;margin:0 0 0.4rem;font-size:11px;white-space:pre"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-scene="deploy" style="${BTN}">deploy</button>
        <button type="button" data-scene="dive" style="${BTN}">dive</button>
        <button type="button" data-scene="gate" style="${BTN}">gate</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="kuang-stats"]')!;

  const dropModes = (): void => {
    if (modes.size > 0) modes.reset();
  };

  const disposeDive = (): void => {
    dropModes();
    dive = null;
    tube?.dispose();
    tube = null;
  };

  const frameDeployCam = (): void => {
    cam.position.set(DEPLOY_CAM.x, DEPLOY_CAM.y, DEPLOY_CAM.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0.4, -10);
    cam.near = 0.4;
    cam.far = 200;
    cam.updateProjectionMatrix();
  };

  const paintHud = (): void => {
    if (scene === 'deploy') {
      hud.setMode('DIVE');
      hud.setSpeed(0);
      hud.setLock(null);
      hud.setBlips([{ angle: 5.5, radius: 0.5, kind: 'kuang' }]);
    }
    hud.update(0);
  };

  const sync = (): void => {
    const phase = dive?.state.phase ?? (scene === 'deploy' ? 'flight' : state.phase);
    stats.textContent = [
      `scene ${scene}  ${phase}`,
      `mimic ${kuang.mimic.toFixed(2)}  reveal ${kuang.reveal.toFixed(2)}`,
      `lane ${state.lane}/${state.lanes}  z ${state.z.toFixed(1)}`,
      `seg ${state.segment}  hits ${state.hits}  m ${(dive?.ice.state.current.m ?? 0).toFixed(2)}`,
    ].join('\n');
    root.dataset.lab = 'kuang';
    root.dataset.scene = scene;
    root.dataset.phase = phase;
    root.dataset.mimic = kuang.mimic.toFixed(3);
    root.dataset.lane = String(state.lane);
    root.dataset.lanes = String(state.lanes);
    root.dataset.z = state.z.toFixed(3);
    root.dataset.speed = String(state.speed);
    root.dataset.hits = String(state.hits);
    root.dataset.tol = String(KUANG_GATE_TOL);
  };

  const applyScene = (next: KuangScene): void => {
    scene = next;
    disposeDive();
    kuang.dispose();
    lastSfx.value = null;
    musicState.value = 'silent';
    if (next === 'deploy') {
      slabs.visible = true;
      kuang = createKuang({ renderer, pose: 'deploy', mimic: 0.18, reveal: 1 });
      kuang.setTime(1.35);
      audio.sfx('kuang');
      audio.music.setState('approach');
      hud.setSpeed(0);
      hud.setLock(null);
      hud.setMode('DIVE');
      frameDeployCam();
      kuang.paint();
    } else {
      slabs.visible = false;
      state = createDiveState({ lanes: DIVE_LANES_DEFAULT, seed: 1, speed: DIVE_SPEED });
      kuang = createKuang({
        renderer,
        pose: 'coil',
        mimic: 0.4,
        reveal: 1,
        coilRadius: DIVE_TUBE_RADIUS * 1.18,
      });
      tube = createDiveTube(renderer, state.lanes, state.radius);
      dive = createDiveMode({
        state,
        tube,
        kuang,
        hud,
        audio,
        camera: cam,
        reduceMotion: opts.reduceMotion ?? (() => settings.value.reduceMotion),
      });
      dropModes();
      modes.push(dive);
      if (next === 'gate') dive.enterGate();
      else dive.paint();
    }
    paintHud();
    sync();
  };

  overlay.querySelectorAll('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.scene;
      if (isKuangScene(id)) applyScene(id);
    });
  });

  const handle: KuangLabHandle = {
    get scene() {
      return scene;
    },
    get mimic() {
      return kuang.mimic;
    },
    get reveal() {
      return kuang.reveal;
    },
    get lane() {
      return state.lane;
    },
    get lanes() {
      return state.lanes;
    },
    get z() {
      return state.z;
    },
    get speed() {
      return state.speed;
    },
    get phase() {
      return dive?.state.phase ?? 'flight';
    },
    get segment() {
      return state.segment;
    },
    get hits() {
      return state.hits;
    },
    get meter() {
      return dive?.ice.state.current.meter ?? 0;
    },
    get m() {
      return dive?.ice.state.current.m ?? 0;
    },
    get knobs() {
      return { R: dive?.knobs.R ?? 1, Phi: dive?.knobs.Phi ?? 0 };
    },
    get musicState() {
      return musicState.value;
    },
    get lastSfx() {
      return lastSfx.value;
    },
    get tolRatio() {
      return KUANG_GATE_TOL;
    },
    setScene(next) {
      applyScene(next);
    },
    setTime(t) {
      kuang.setTime(t);
      paintHud();
      sync();
    },
    setMimic(v) {
      kuang.mimic = v < 0 ? 0 : v > 1 ? 1 : v;
      kuang.paint();
      paintHud();
      sync();
    },
    setLane(lane) {
      state.lane = (((lane | 0) % state.lanes) + state.lanes) % state.lanes;
      dive?.paint();
      paintHud();
      sync();
    },
    stepLane(dir) {
      const next = stepLane(state.lane, state.lanes, dir, false, 0, 1 / 60);
      state.lane = next.lane;
      dive?.paint();
      paintHud();
      sync();
    },
    enterGate() {
      if (scene === 'deploy') applyScene('gate');
      else dive?.enterGate();
      paintHud();
      sync();
    },
    crackGate() {
      dive?.forceCrack();
      paintHud();
      sync();
    },
    advance(dt) {
      if (scene === 'deploy') {
        kuang.mimic = Math.min(1, kuang.mimic + dt / KUANG_MIMIC_S);
        kuang.update(dt, opts.reduceMotion?.() ?? false);
      } else {
        const frame = input.sample(dt);
        if (modes.size > 0) {
          modes.handleInput(frame);
          modes.update(dt);
        }
      }
      paintHud();
      sync();
    },
    paint() {
      if (scene === 'deploy') {
        frameDeployCam();
        kuang.paint();
      } else {
        dive?.paint();
      }
      paintHud();
      hud.update(0);
      sync();
    },
  };

  window.__nonspaceKuang = handle;
  applyScene(startScene);

  return {
    update(dt) {
      if (scene === 'deploy') {
        kuang.mimic = Math.min(1, kuang.mimic + dt / KUANG_MIMIC_S);
        kuang.update(dt, opts.reduceMotion?.() ?? false);
        frameDeployCam();
      }
      paintHud();
      sync();
    },
    dispose() {
      overlay.remove();
      disposeDive();
      kuang.dispose();
      renderer.scenes.matrix.remove(slabs.object);
      slabs.dispose();
      hud.dispose();
      persist.decayScale = 1;
      cam.position.set(saved.x, saved.y, saved.z);
      cam.near = saved.near;
      cam.far = saved.far;
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      if (window.__nonspaceKuang === handle) delete window.__nonspaceKuang;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.phase;
      delete root.dataset.mimic;
      delete root.dataset.lane;
      delete root.dataset.lanes;
      delete root.dataset.z;
      delete root.dataset.speed;
      delete root.dataset.hits;
      delete root.dataset.tol;
    },
  };
}
