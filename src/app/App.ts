import { WebGLRenderer } from 'three';
import { createEventBus, type EventBus } from '../core/events';
import { createLoop, type Loop } from '../core/loop';
import { createSaveStore, type SaveStore } from '../core/save';
import { createSettingsStore, type SettingsStore } from '../core/settings';
import type { DebugGui } from '../debug/DebugGui';
import { createGpuTimer, type GpuTimer } from '../debug/gpuTimer';
import { createInput, type InputService } from '../input/Input';
import { createMissionRunner, type MissionRunner } from '../narrative/MissionRunner';
import { getMockMission } from '../narrative/mocks';
import { createCameraRig, type CameraRig } from '../player/CameraRig';
import { createCollisionWorld, type CollisionWorld } from '../player/Collision';
import { createFlightController, type FlightController } from '../player/FlightController';
import { createModeStack, type ModeStack } from './ModeStack';

export interface AppOptions {
  root: HTMLElement;
  debug: boolean;
  /** `?mission=` — mock id, loaded only in dev or with `?debug`. */
  missionId?: string;
  /** `?checkpoint=` — captured or seeked after start. */
  checkpoint?: string;
}

export interface App {
  readonly renderer: WebGLRenderer;
  readonly events: EventBus;
  readonly loop: Loop;
  readonly modes: ModeStack;
  readonly save: SaveStore;
  readonly settings: SettingsStore;
  readonly mission: MissionRunner;
  readonly input: InputService;
  readonly flight: FlightController;
  readonly cameraRig: CameraRig;
  readonly collision: CollisionWorld;
  dispose(): void;
}

declare global {
  interface Window {
    /** The running App, exposed under `?debug`, `?lab=input` and `?lab=flight`. */
    __nonspace?: App;
  }
}

/**
 * Bootstrap: a full-window canvas driving the fixed-step loop, mode stack,
 * event bus, save, settings and input. The Renderer service replaces the raw
 * WebGLRenderer setup here.
 */
export async function startApp({ root, debug, missionId, checkpoint }: AppOptions): Promise<App> {
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = false;
  root.appendChild(renderer.domElement);

  const collision = createCollisionWorld();
  const flight = createFlightController({ collision });
  const cameraRig = createCameraRig({
    aspect: window.innerWidth / Math.max(window.innerHeight, 1),
  });

  const resize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    cameraRig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
  };
  resize();
  window.addEventListener('resize', resize);

  const events = createEventBus();
  const save = createSaveStore();
  save.load();
  const settings = createSettingsStore(save.data.settings, (s) => {
    save.data.settings = s;
    save.commit();
  });
  const input = createInput({
    settings,
    target: renderer.domElement,
    window,
    document,
  });
  const mission = createMissionRunner({ events, save });
  const modes = createModeStack({ events, settings, save, mission, input, flight });
  const allowMissionRoute = debug || import.meta.env.DEV;
  if (allowMissionRoute && missionId) {
    const def = getMockMission(missionId);
    if (!def) {
      console.warn(`[nonspace] unknown mock mission '${missionId}'`);
    } else {
      mission.load(def);
      mission.start(checkpoint ? { checkpoint } : undefined);
    }
  }
  let flightLab: { render(alpha: number): void; dispose(): void } | null = null;

  const loop = createLoop({
    update(dt) {
      const frame = input.sample(dt);
      modes.handleInput(frame);
      if (flightLab) flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
      mission.update(dt);
      modes.update(dt);
      events.flush();
    },
    render(alpha) {
      flightLab?.render(alpha);
      modes.render(alpha);
    },
  });
  // rAF stops in background tabs; don't count the hidden time as dropped.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') loop.resetClock();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (debug) {
    gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
    const { createDebugGui } = await import('../debug/DebugGui');
    gui = createDebugGui({ gpuTimerAvailable: gpuTimer !== null });
    const sim = gui.pane.addFolder({ title: 'sim' });
    const int = (v: number): string => v.toFixed(0);
    sim.addBinding(loop.stats, 'ticks', { readonly: true, format: int });
    sim.addBinding(loop.stats, 'stepsLastFrame', {
      readonly: true,
      label: 'steps/frame',
      format: int,
    });
    sim.addBinding(loop.stats, 'droppedTime', {
      readonly: true,
      label: 'dropped s',
      format: (v: number) => v.toFixed(2),
    });
    const mis = gui.pane.addFolder({ title: 'mission' });
    mis.addBinding(mission.debug, 'id', { readonly: true });
    mis.addBinding(mission.debug, 'status', { readonly: true });
    mis.addBinding(mission.debug, 'time', {
      readonly: true,
      format: (v: number) => v.toFixed(2),
    });
    mis.addBinding(mission.debug, 'meatTime', {
      readonly: true,
      label: 'meat',
      format: (v: number) => v.toFixed(2),
    });
    mis.addBinding(mission.debug, 'checkpoint', { readonly: true });
    const fly = gui.pane.addFolder({ title: 'flight' });
    const p = flight.params;
    fly.addBinding(p, 'cruiseMaxSpeed', { min: 1, max: 400, step: 1, label: 'cruise u/s' });
    fly.addBinding(p, 'boostMaxSpeed', { min: 1, max: 2000, step: 1, label: 'boost u/s' });
    fly.addBinding(p, 'cruiseAccel', { min: 1, max: 2000, step: 1, label: 'accel cruise' });
    fly.addBinding(p, 'boostAccel', { min: 1, max: 4000, step: 1, label: 'accel boost' });
    fly.addBinding(p, 'dragHalfLife', { min: 0.05, max: 3, step: 0.05, label: 'drag half-life' });
    fly.addBinding(p, 'pitchClampDeg', { min: 10, max: 89, step: 1, label: 'pitch clamp °' });
    fly.addBinding(p, 'bankMaxDeg', { min: 0, max: 30, step: 0.5, label: 'bank max °' });
    fly.addBinding(p, 'autoLevelHalfLife', {
      min: 0.05,
      max: 2,
      step: 0.05,
      label: 'auto-level s',
    });
    fly.addBinding(p, 'fovBase', { min: 40, max: 100, step: 1, label: 'FOV base °' });
    fly.addBinding(p, 'fovKick', { min: 0, max: 30, step: 0.5, label: 'FOV kick °' });
    fly.addBinding(p, 'gridAssist');
    fly.addBinding(p, 'gridAssistConeDeg', { min: 1, max: 45, step: 1, label: 'assist cone °' });
    fly.addBinding(p, 'gridAssistRateDeg', { min: 1, max: 180, step: 1, label: 'assist °/s' });
    fly.addBinding(p, 'banking');
    fly.addBinding(p, 'fovKickEnabled', { label: 'FOV kick on' });
    fly.addBinding(p, 'hullSpringRadius', { min: 0, max: 80, step: 1, label: 'hull spring u' });
    fly.addBinding(p, 'altitudeCeiling', { min: 100, max: 40_000, step: 100, label: 'ceiling u' });
    const live = fly.addFolder({ title: 'live', expanded: false });
    live.addBinding(flight.telemetry, 'speed', { readonly: true });
    live.addBinding(flight.telemetry, 'altitude', { readonly: true });
    live.addBinding(flight.telemetry, 'headingDeg', { readonly: true, label: 'heading °' });
    live.addBinding(flight.telemetry, 'fov', { readonly: true });
    live.addBinding(flight.telemetry, 'flare', { readonly: true });
  }

  let last = performance.now();
  let firstFrame = true;

  const frame = (now: number): void => {
    const dt = now - last;
    last = now;

    gpuTimer?.begin();
    renderer.clear();
    loop.frame(now);
    gpuTimer?.end();

    if (gui) gui.frame(dt, gpuTimer ? gpuTimer.poll() : null);
    if (firstFrame) {
      firstFrame = false;
      root.dataset.status = 'running';
    }
  };
  renderer.setAnimationLoop(frame);

  const lab = new URLSearchParams(window.location.search).get('lab');
  let inputLab: { dispose(): void } | null = null;

  const app: App = {
    renderer,
    events,
    loop,
    modes,
    save,
    settings,
    mission,
    input,
    flight,
    cameraRig,
    collision,
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      modes.reset();
      mission.dispose();
      events.clear();
      inputLab?.dispose();
      flightLab?.dispose();
      cameraRig.dispose();
      input.dispose();
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (window.__nonspace === app) delete window.__nonspace;
    },
  };
  if (debug || lab === 'input' || lab === 'flight') window.__nonspace = app;
  if (lab === 'input') {
    const { createInputLab } = await import('../input/InputLab');
    inputLab = createInputLab(input, settings, root);
  }
  if (lab === 'flight') {
    const { createFlightLab } = await import('../player/FlightLab');
    flightLab = createFlightLab({ renderer, flight, cameraRig, root });
  }
  return app;
}
