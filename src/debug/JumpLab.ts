/**
 * Dev route `?lab=jump` (M2.6). Coordinate jump + COORD address book over a
 * ground grid. Lazy `?lab=` chunk — default boot never fetches it.
 *
 * Query: `&scene=idle|streak|arrive`. Playwright freezes `setAnimationLoop`
 * before snapshots and steps with `tick` / `endFrame` (no live 1080p spin).
 */

import { Color } from 'three';
import { createNoopAudioEngine, type AudioEngine, type SfxId } from '../audio/AudioEngine';
import type { Mode, ModeStack } from '../app/ModeStack';
import {
  createDeckPanelMode,
  DEFAULT_ADDRESS_BOOK,
  type DeckPanelMode,
} from '../app/modes/DeckPanel';
import type { InputService } from '../input/Input';
import type { CameraRig } from '../player/CameraRig';
import {
  createCoordinateJump,
  jumpFailMessage,
  JUMP_ALIGN,
  type CoordinateJump,
} from '../player/CoordinateJump';
import type { FlightController } from '../player/FlightController';
import { createGroundGrid, type GroundGrid } from '../render/grid/GroundGrid';
import { createLocalLattice, type LocalLattice } from '../render/grid/LocalLattice';
import { createJumpStreak, sampleJumpStreak, type JumpStreak } from '../render/fx/JumpStreak';
import type { PersistencePass } from '../render/post/PersistencePass';
import type { Renderer } from '../render/Renderer';
import { formatMatrixCoord, parseMatrixCoord, sectorCenter } from '../world/coords';
import type { SectorData } from '../world/Sector';
import {
  createSectorStreamer,
  createSyncBackend,
  type SectorStreamer,
} from '../world/SectorStreamer';
import { el, ensureCrtStyles } from '../hud/dom/theme';

export const JUMP_SCENES = ['idle', 'streak', 'arrive'] as const;
export type JumpScene = (typeof JUMP_SCENES)[number];

export function isJumpScene(value: string | null | undefined): value is JumpScene {
  return (JUMP_SCENES as readonly string[]).includes(value ?? '');
}

export const JUMP_START = sectorCenter(148, 72);
export const JUMP_START_Y = 120;
export const JUMP_DEFAULT_COORD =
  DEFAULT_ADDRESS_BOOK.find((e) => e.id === 'chiba-node')?.coord ?? 'CHBA 0412.90 / 0180.20 / 0160';

export interface JumpLab {
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface JumpLabHandle {
  scene: JumpScene;
  phase: string;
  elapsed: number;
  duration: number;
  streakDuration: number;
  active: boolean;
  lastError: string | null;
  lastJump: string | null;
  destReady: boolean;
  standoff: number;
  speed: number;
  sfx: readonly string[];
  deckOpen: boolean;
  gripped: boolean;
  inCore: boolean;
  trace: number;
  startCoord(raw: string): boolean;
  seek(time: number): void;
  tick(dt: number): void;
  setGrip(on: boolean): void;
  setCore(on: boolean): void;
  setTrace(value: number): void;
  openDeck(): void;
  closeDeck(): void;
}

declare global {
  interface Window {
    __nonspaceJump?: JumpLabHandle;
  }
}

export interface JumpLabOptions {
  renderer: Renderer;
  flight: FlightController;
  cameraRig: CameraRig;
  modes: ModeStack;
  input: InputService;
  root: HTMLElement;
  scene?: string | null;
  reduceMotion?: () => boolean;
}

const CSS = [
  'position:fixed',
  'inset:auto 0.6rem 0.6rem auto',
  'pointer-events:auto',
  'font:11px/1.35 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:50',
  'background:rgba(0,0,0,0.55)',
  'padding:0.45rem 0.6rem',
  'border:1px solid #1a3348',
  'letter-spacing:0.12em',
].join(';');

const BTN =
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.22rem 0.45rem;font:inherit;cursor:pointer;margin:0.12rem 0.12rem 0 0';

function stubSector(sx: number, sz: number, worldSeed: number): SectorData {
  return {
    sx,
    sz,
    worldSeed,
    region: 'BAMA',
    density: 0.2,
    constructs: [],
    clusters: [],
    traffic: [],
    watchers: [],
    contentHash: ((sx * 4096 + sz) ^ worldSeed) >>> 0,
  };
}

export function installJumpLab(opts: JumpLabOptions): JumpLab {
  ensureCrtStyles();
  const { renderer, flight, cameraRig, modes, input, root } = opts;
  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0;
  renderer.scenes.matrix.background = new Color(0x000000);

  const persist = renderer.chain.getPass('persistence') as PersistencePass;
  const grid: GroundGrid = createGroundGrid(renderer.palette);
  const lattice: LocalLattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  const streak: JumpStreak = createJumpStreak({
    palette: renderer.palette,
    scene: renderer.scenes.matrix,
  });
  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);

  const streamer: SectorStreamer = createSectorStreamer({
    backend: createSyncBackend(stubSector),
    worldSeed: 1,
  });

  const sfxCalls: SfxId[] = [];
  const inner = createNoopAudioEngine();
  const audio: AudioEngine = {
    ...inner,
    sfx(id, sfxOpts) {
      sfxCalls.push(id);
      inner.sfx(id, sfxOpts);
    },
  };

  let gripped = false;
  let inCore = false;
  let trace = 0;
  let deckMode: DeckPanelMode | null = null;
  let scene: JumpScene = isJumpScene(opts.scene) ? opts.scene : 'idle';

  flight.setPose({
    x: JUMP_START.x,
    y: JUMP_START_Y,
    z: JUMP_START.z,
    yaw: Math.PI / 2,
    pitch: -0.08,
    vx: 0,
    vy: 0,
    vz: 0,
    fov: flight.params.fovBase,
  });
  streamer.update(JUMP_START.x, JUMP_START_Y, JUMP_START.z);
  cameraRig.apply(flight, 1);

  const jump: CoordinateJump = createCoordinateJump({
    flight,
    gripped: () => gripped,
    inCore: () => inCore,
    trace: () => trace,
    reduceMotion: () => opts.reduceMotion?.() === true,
    preload: (x, _y, z) => streamer.preload(x, z),
    arrive: (x, y, z) => streamer.update(x, y, z),
    onStart: () => audio.sfx('jump'),
    onArrive: () => audio.sfx('jumpArrive'),
  });

  const matrixStub: Mode = {
    id: 'matrix',
    simulatesWhenCovered: true,
    enter() {},
    exit() {},
    update() {},
    render() {},
    handleInput(frame) {
      if (jump.active) return;
      if (frame.pressed('deck')) openDeck();
    },
  };

  const closeDeck = (): void => {
    if (modes.has('deckPanel')) modes.pop();
    deckMode = null;
  };

  const openDeck = (): void => {
    if (jump.active || modes.has('deckPanel')) return;
    deckMode = createDeckPanelMode({
      input,
      addressBook: DEFAULT_ADDRESS_BOOK,
      onJump: (coord) => {
        const r = jump.start(coord);
        if (!r.ok) return jumpFailMessage(r.reason);
        return;
      },
      onError: () => audio.sfx('deckError'),
    });
    modes.push(deckMode);
  };

  const startCoord = (raw: string): boolean => {
    const parsed = parseMatrixCoord(raw);
    if (!parsed) {
      audio.sfx('deckError');
      if (deckMode) {
        /* panel submit path handles BAD COORD */
      }
      return false;
    }
    const r = jump.start(parsed);
    if (!r.ok) {
      audio.sfx('deckError');
      return false;
    }
    closeDeck();
    return true;
  };

  const applyFx = (): void => {
    const sample = sampleJumpStreak(jump.phase, jump.streakU, opts.reduceMotion?.() === true);
    if ('decayScale' in persist) persist.decayScale = sample.decayScale;
    const dest = jump.targetWorld ?? { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z };
    streak.update(flight.pose, dest, sample, {
      w: renderer.internalWidth,
      h: renderer.internalHeight,
    });
    lattice.radius = renderer.quality.latticeRadius;
    lattice.update(renderer.cameras.matrix.position);
  };

  const overlay = el('div', { 'data-testid': 'jump-lab' });
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="letter-spacing:0.28em;color:#6a8aaa;margin:0 0 0.25rem">JUMP · M2.6</div>
    <div data-testid="jump-lab-stats" style="color:#6a8aaa;white-space:pre"></div>
    <div style="margin-top:0.35rem">
      <button type="button" data-testid="jump-go" style="${BTN}">jump chiba</button>
      <button type="button" data-testid="jump-deck" style="${BTN}">deck</button>
      <button type="button" data-testid="jump-grip" style="${BTN}">grip</button>
      <button type="button" data-testid="jump-core" style="${BTN}">core</button>
      <button type="button" data-testid="jump-trace" style="${BTN}">trace 100</button>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="jump-lab-stats"]')!;
  overlay.querySelector('[data-testid="jump-go"]')!.addEventListener('click', () => {
    startCoord(JUMP_DEFAULT_COORD);
  });
  overlay.querySelector('[data-testid="jump-deck"]')!.addEventListener('click', () => {
    if (deckMode?.panel.open) closeDeck();
    else openDeck();
  });
  overlay.querySelector('[data-testid="jump-grip"]')!.addEventListener('click', () => {
    gripped = !gripped;
  });
  overlay.querySelector('[data-testid="jump-core"]')!.addEventListener('click', () => {
    inCore = !inCore;
  });
  overlay.querySelector('[data-testid="jump-trace"]')!.addEventListener('click', () => {
    trace = trace >= 100 ? 0 : 100;
  });

  const handle: JumpLabHandle = {
    get scene() {
      return scene;
    },
    get phase() {
      return jump.phase;
    },
    get elapsed() {
      return jump.elapsed;
    },
    get duration() {
      return jump.duration;
    },
    get streakDuration() {
      return jump.streakDuration;
    },
    get active() {
      return jump.active;
    },
    get lastError() {
      return deckMode?.panel.lastError ?? null;
    },
    get lastJump() {
      const j = jump.target ?? deckMode?.panel.lastJump;
      return j ? formatMatrixCoord(j) : null;
    },
    get destReady() {
      const a = jump.arrival;
      return a ? streamer.readyAround(a.x, a.z) : false;
    },
    get standoff() {
      const a = jump.arrival;
      const t = jump.targetWorld;
      if (!a || !t) return 0;
      return Math.hypot(t.x - flight.pose.x, t.y - flight.pose.y, t.z - flight.pose.z);
    },
    get speed() {
      return flight.telemetry.speed;
    },
    get sfx() {
      return sfxCalls;
    },
    get deckOpen() {
      return deckMode?.panel.open === true;
    },
    get gripped() {
      return gripped;
    },
    get inCore() {
      return inCore;
    },
    get trace() {
      return trace;
    },
    startCoord,
    seek(time) {
      jump.seek(time);
      applyFx();
    },
    tick(dt) {
      if (jump.active || jump.phase === 'done') jump.step(dt);
      else if (!deckMode?.panel.open) {
        flight.step(input.frame, dt, { reduceMotion: opts.reduceMotion?.() === true });
        streamer.update(flight.pose.x, flight.pose.y, flight.pose.z);
      }
      applyFx();
    },
    setGrip(on) {
      gripped = on;
    },
    setCore(on) {
      inCore = on;
    },
    setTrace(value) {
      trace = value;
    },
    openDeck,
    closeDeck,
  };

  const show = (next: JumpScene): void => {
    scene = next;
    modes.reset();
    deckMode = null;
    modes.push(matrixStub);
    if (next === 'idle') openDeck();
    if (next === 'streak' || next === 'arrive') {
      startCoord(JUMP_DEFAULT_COORD);
      const t = next === 'arrive' ? jump.duration : JUMP_ALIGN + jump.streakDuration * 0.55;
      jump.seek(t);
    }
    applyFx();
    root.dataset.scene = next;
  };

  const syncHud = (): void => {
    stats.textContent = [
      `${scene}  ${jump.phase}`,
      `t ${jump.elapsed.toFixed(2)} / ${jump.duration.toFixed(2)}`,
      `standoff ${handle.standoff.toFixed(0)}  spd ${handle.speed.toFixed(0)}`,
      `dest ${handle.destReady ? 'ready' : 'load'}  sfx ${sfxCalls.length}`,
    ].join('\n');
    root.dataset.phase = jump.phase;
    root.dataset.deckOpen = handle.deckOpen ? '1' : '0';
  };

  window.__nonspaceJump = handle;
  root.dataset.lab = 'jump';
  show(scene);
  syncHud();

  return {
    update(dt) {
      handle.tick(dt);
      syncHud();
    },
    render(alpha) {
      cameraRig.apply(flight, alpha);
      syncHud();
    },
    dispose() {
      if ('decayScale' in persist) persist.decayScale = 1;
      overlay.remove();
      streak.dispose();
      grid.dispose();
      lattice.dispose();
      streamer.dispose();
      renderer.scenes.matrix.remove(grid.object);
      renderer.scenes.matrix.remove(lattice.object);
      modes.reset();
      if (window.__nonspaceJump === handle) delete window.__nonspaceJump;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.phase;
      delete root.dataset.deckOpen;
    },
  };
}
