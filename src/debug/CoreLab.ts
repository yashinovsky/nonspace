/**
 * Dev route `?lab=core` (M4.5). Core cathedral, on-beat target / off-beat
 * decoys, download hold, jack-out vs route-out re-freeze. Query:
 * `?lab=core&scene=cathedral|download|exfil|route&seed=1`.
 * Lazy-imported from App so the default-boot graph never fetches it.
 */

import { createCoreMode } from '../app/modes/Core';
import { createJackOutMode } from '../app/modes/JackOut';
import type { ModeStack } from '../app/ModeStack';
import {
  CORE_BPM,
  CORE_STRATA_MAX,
  CORE_STRATA_MIN,
  createCoreInterior,
  DOWNLOAD_HOLD_S,
  type CoreInterior,
  type CorePhase,
} from '../breach/CoreInterior';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createHud } from '../hud/Hud';
import type { InputService } from '../input/Input';
import { createCameraRig, type CameraRig } from '../player/CameraRig';
import type { FlightController } from '../player/FlightController';
import { Beam, createBeamBatch, createLineSet, lineSetCount } from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import { layoutHershey, loadHersheyFont, type HersheyFont } from '../render/text/HersheyText';

export const CORE_SCENES = ['cathedral', 'download', 'exfil', 'route'] as const;
export type CoreScene = (typeof CORE_SCENES)[number];

export function isCoreScene(value: string | null): value is CoreScene {
  return (CORE_SCENES as readonly string[]).includes(value ?? '');
}

/** 3/4 exterior view of the nave — not inside the stacked planes (that blew HDR white). */
const CAM_X = 38;
const CAM_Y = 46;
const CAM_Z = 70;
const LOOK_Y = 28;
const START = {
  x: CAM_X,
  y: CAM_Y,
  z: CAM_Z,
  yaw: Math.atan2(CAM_X, CAM_Z),
  pitch: Math.atan2(CAM_Y - LOOK_Y, Math.hypot(CAM_X, CAM_Z)),
  vx: 0,
  vy: 0,
  vz: 0,
} as const;
const LAB_SEED = 1;
const LAB_STRATA = 8;
const LAB_RECORD = 'REC-0001';
const LAB_LAYERS = 4;

export interface CoreLab {
  update(dt: number): void;
  dispose(): void;
}

export interface CoreLabHandle {
  scene: CoreScene;
  seed: number;
  strata: number;
  phase: CorePhase;
  download: number;
  downloaded: boolean;
  targetPulse: number;
  decoyPulse: number;
  freezeProgress: number;
  frozenLayers: number;
  layerCount: number;
  trace: number;
  nearTarget: boolean;
  target: { x: number; y: number; z: number; code: string };
  setTime(t: number): void;
  holdDownload(seconds: number): void;
  completeDownload(): void;
  startRouteOut(): boolean;
  startJackOut(): boolean;
  advance(dt: number): void;
  paint(): void;
}

declare global {
  interface Window {
    __nonspaceCore?: CoreLabHandle;
  }
}

export interface CoreLabOptions {
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  input: InputService;
  flight: FlightController;
  modes: ModeStack;
  root: HTMLElement;
  scene?: string | null;
  seed?: string | null;
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

function parseSeed(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : LAB_SEED;
}

export async function installCoreLab(opts: CoreLabOptions): Promise<CoreLab> {
  const { renderer, events, settings, input, flight, modes, root } = opts;
  const startScene: CoreScene = isCoreScene(opts.scene ?? null)
    ? (opts.scene as CoreScene)
    : 'cathedral';
  const seed = parseSeed(opts.seed);

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.3;
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();
  renderer.cameras.matrix.near = 0.4;
  renderer.cameras.matrix.far = 400;
  renderer.cameras.matrix.updateProjectionMatrix();

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
  hud.setCoords('CHBA 0000.00 / 0000.00 / 0016');
  hud.setSpeed(0);
  hud.setPipLink(false);
  hud.setMode('CORE');

  let interior: CoreInterior = createCoreInterior({
    events,
    def: {
      seed,
      strata: LAB_STRATA,
      targetRecord: LAB_RECORD,
      layers: LAB_LAYERS,
      bpm: CORE_BPM,
      downloadHold: DOWNLOAD_HOLD_S,
    },
  });

  const rig: CameraRig = createCameraRig({ camera: renderer.cameras.matrix });
  flight.setPose({ ...START });

  const labelsBatch = createBeamBatch(renderer.palette, { capacity: 1024 });
  renderer.scenes.matrix.add(labelsBatch.object);
  let font: HersheyFont | null = null;
  try {
    font = await loadHersheyFont('/fonts/hershey/simplex.bin.gz');
  } catch {
    font = null;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="core-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.3rem">CORE · M4.5</div>
      <div data-testid="core-stats" style="color:#c8e4ff;margin:0 0 0.4rem;font-size:11px;white-space:pre"></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
        <button type="button" data-testid="core-download" style="${BTN}">download</button>
        <button type="button" data-testid="core-route" style="${BTN}">route out</button>
        <button type="button" data-testid="core-jack" style="${BTN}">jack out</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="core-stats"]')!;

  let scene = startScene;

  const dropModes = (): void => {
    if (modes.size > 0) modes.reset();
  };

  const paintHud = (): void => {
    hud.setTrace(interior.trace.value);
    hud.setSpeed(flight.telemetry.speed);
    hud.setFlatline(false);
    hud.setLock(null);
    hud.setGrip(null);
    if (interior.phase === 'routeOut') hud.setMode('EXFIL');
    else hud.setMode('CORE');
    if (interior.phase === 'download') {
      hud.print(`DOWNLOAD ${Math.round(interior.download * 100)}%`);
    }
    hud.update(0);
  };

  const layoutLabels = (): void => {
    if (!font) return;
    const chunks = [];
    const t = interior.layout.target;
    chunks.push(
      layoutHershey(font, t.code, {
        capHeight: 0.5,
        color: Beam.AMBER,
        intensity: 0.85,
        width: 1.15,
        align: 'center',
        x: t.cx,
        y: t.cy + 2.2,
        z: t.cz,
      }),
    );
    const sample = interior.layout.records.filter((_, i) => i % 17 === 0).slice(0, 5);
    for (const rec of sample) {
      chunks.push(
        layoutHershey(font, rec.code, {
          capHeight: 0.2,
          color: Beam.GRID,
          intensity: 0.32,
          width: 1.0,
          align: 'center',
          x: rec.x,
          y: rec.y + 0.35,
          z: rec.z,
        }),
      );
    }
    let n = 0;
    for (const c of chunks) n += lineSetCount(c);
    const merged = createLineSet(n, { width: true, flags: true });
    let w = 0;
    for (const c of chunks) {
      const k = lineSetCount(c);
      merged.positions.set(c.positions.subarray(0, k * 6), w * 6);
      merged.color.set(c.color.subarray(0, k), w);
      merged.intensity.set(c.intensity.subarray(0, k), w);
      if (merged.width) {
        if (c.width) merged.width.set(c.width.subarray(0, k), w);
        else merged.width.fill(1.3, w, w + k);
      }
      w += k;
    }
    labelsBatch.setStatic(merged);
  };

  const rebuild = (): void => {
    interior.dispose();
    interior = createCoreInterior({
      events,
      def: {
        seed,
        strata: LAB_STRATA,
        targetRecord: LAB_RECORD,
        layers: LAB_LAYERS,
        bpm: CORE_BPM,
        downloadHold: DOWNLOAD_HOLD_S,
      },
    });
    interior.attach(renderer);
    interior.trace.reset(22);
    layoutLabels();
  };

  const poseAtTarget = (): void => {
    const t = interior.layout.target;
    flight.setPose({
      x: t.cx,
      y: t.cy + 2,
      z: t.cz + 8,
      yaw: 0,
      pitch: -0.15,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  };

  const pushCore = (): void => {
    dropModes();
    modes.push(
      createCoreMode({
        interior,
        hud,
        flight,
        reduceMotion: opts.reduceMotion ?? (() => settings.value.reduceMotion),
        onDownloaded() {
          hud.print(`GOT ${LAB_RECORD}`);
        },
        onJackOut() {
          dropModes();
          modes.push(createJackOutMode({ reason: 'player', emit: false }));
        },
        onRouteOut() {
          hud.print('ROUTE OUT');
        },
        onRouteDone() {
          hud.print('HOLE CLOSED');
        },
        onBurned() {
          dropModes();
          modes.push(createJackOutMode({ reason: 'burned', emit: false }));
        },
      }),
    );
  };

  const applyScene = (next: CoreScene): void => {
    scene = next;
    dropModes();
    rebuild();
    flight.setPose({ ...START });
    interior.setTime(0);
    if (next === 'download') {
      poseAtTarget();
      interior.step(0, {
        downloadHeld: false,
        player: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
      });
    } else if (next === 'exfil') {
      poseAtTarget();
      interior.completeDownload();
    } else if (next === 'route') {
      poseAtTarget();
      interior.completeDownload();
      interior.startRouteOut();
      interior.step(interior.refreezeDuration * 0.55, {
        downloadHeld: false,
        player: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
      });
    }
    pushCore();
    interior.paint();
    paintHud();
  };

  overlay.querySelector('[data-testid="core-download"]')!.addEventListener('click', () => {
    poseAtTarget();
    interior.completeDownload();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="core-route"]')!.addEventListener('click', () => {
    if (!interior.downloaded) interior.completeDownload();
    interior.startRouteOut();
    paintHud();
    sync();
  });
  overlay.querySelector('[data-testid="core-jack"]')!.addEventListener('click', () => {
    if (!interior.downloaded) interior.completeDownload();
    interior.startJackOut();
    dropModes();
    modes.push(createJackOutMode({ reason: 'player', emit: false }));
    paintHud();
    sync();
  });

  const sync = (): void => {
    const t = interior.layout.target;
    stats.textContent = [
      `scene ${scene}  ${interior.phase}`,
      `seed ${seed}  strata ${interior.layout.strataCount}`,
      `target ${t.code}  pulse ${interior.targetPulse.toFixed(2)}`,
      `decoy ${interior.decoyPulse.toFixed(2)}  dl ${(interior.download * 100).toFixed(0)}%`,
      `trace ${interior.trace.value.toFixed(0)}  freeze ${interior.frozenLayers}/${interior.layerCount}`,
    ].join('\n');
    root.dataset.lab = 'core';
    root.dataset.scene = scene;
    root.dataset.phase = interior.phase;
    root.dataset.seed = String(seed);
    root.dataset.strata = String(interior.layout.strataCount);
    root.dataset.download = interior.download.toFixed(3);
    root.dataset.downloaded = interior.downloaded ? '1' : '0';
    root.dataset.freeze = interior.freezeProgress.toFixed(3);
    root.dataset.frozen = String(interior.frozenLayers);
    root.dataset.trace = String(Math.round(interior.trace.value));
    root.dataset.targetPulse = interior.targetPulse.toFixed(3);
    root.dataset.decoyPulse = interior.decoyPulse.toFixed(3);
    root.dataset.bpm = String(CORE_BPM);
    root.dataset.strataMin = String(CORE_STRATA_MIN);
    root.dataset.strataMax = String(CORE_STRATA_MAX);
  };

  const handle: CoreLabHandle = {
    get scene() {
      return scene;
    },
    get seed() {
      return seed;
    },
    get strata() {
      return interior.layout.strataCount;
    },
    get phase() {
      return interior.phase;
    },
    get download() {
      return interior.download;
    },
    get downloaded() {
      return interior.downloaded;
    },
    get targetPulse() {
      return interior.targetPulse;
    },
    get decoyPulse() {
      return interior.decoyPulse;
    },
    get freezeProgress() {
      return interior.freezeProgress;
    },
    get frozenLayers() {
      return interior.frozenLayers;
    },
    get layerCount() {
      return interior.layerCount;
    },
    get trace() {
      return interior.trace.value;
    },
    get nearTarget() {
      return interior.nearTarget;
    },
    get target() {
      const t = interior.layout.target;
      return { x: t.cx, y: t.cy, z: t.cz, code: t.code };
    },
    setTime(t) {
      interior.setTime(t);
      interior.paint();
      paintHud();
      sync();
    },
    holdDownload(seconds) {
      poseAtTarget();
      const player = { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z };
      interior.step(seconds, { downloadHeld: true, player });
      interior.paint();
      paintHud();
      sync();
    },
    completeDownload() {
      poseAtTarget();
      interior.completeDownload();
      interior.paint();
      paintHud();
      sync();
    },
    startRouteOut() {
      if (!interior.downloaded) interior.completeDownload();
      const ok = interior.startRouteOut();
      interior.paint();
      paintHud();
      sync();
      return ok;
    },
    startJackOut() {
      if (!interior.downloaded) interior.completeDownload();
      const ok = interior.startJackOut();
      interior.paint();
      paintHud();
      sync();
      return ok;
    },
    advance(dt) {
      const frame = input.sample(dt);
      if (scene !== 'cathedral' && interior.phase !== 'routeOut') {
        // Parked for posed scenes so SwiftShader siblings are not starved.
      } else if (interior.phase === 'routeOut' || scene === 'cathedral') {
        flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      if (modes.size > 0) {
        modes.handleInput(frame);
        modes.update(dt);
      } else {
        interior.step(dt, {
          downloadHeld: frame.down('download'),
          player: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
          jackHeld: frame.held('jackOut'),
          engagePressed: frame.pressed('engage'),
        });
      }
      rig.apply(flight, 1);
      interior.paint();
      paintHud();
      sync();
    },
    paint() {
      rig.apply(flight, 1);
      interior.paint();
      paintHud();
      hud.update(0);
      sync();
    },
  };

  window.__nonspaceCore = handle;

  applyScene(startScene);
  rig.apply(flight, 1);
  interior.paint();
  paintHud();
  sync();

  return {
    update(dt) {
      if (interior.phase === 'routeOut') {
        const frame = input.frame;
        flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      rig.apply(flight, 1);
      interior.paint();
      paintHud();
      sync();
    },
    dispose() {
      overlay.remove();
      dropModes();
      interior.dispose();
      renderer.scenes.matrix.remove(labelsBatch.object);
      labelsBatch.dispose();
      hud.dispose();
      if (window.__nonspaceCore === handle) delete window.__nonspaceCore;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.phase;
      delete root.dataset.seed;
      delete root.dataset.strata;
      delete root.dataset.download;
      delete root.dataset.downloaded;
      delete root.dataset.freeze;
      delete root.dataset.frozen;
      delete root.dataset.trace;
      delete root.dataset.targetPulse;
      delete root.dataset.decoyPulse;
      delete root.dataset.bpm;
      delete root.dataset.strataMin;
      delete root.dataset.strataMax;
    },
  };
}
