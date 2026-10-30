import { createEventBus, type EventBus } from '../core/events';
import { createLoop, type Loop } from '../core/loop';
import { createSaveStore, type SaveStore } from '../core/save';
import { createSettingsStore, type SettingsStore, type QualitySetting } from '../core/settings';
import type { DebugGui } from '../debug/DebugGui';
import { createGpuTimer, type GpuTimer } from '../debug/gpuTimer';
import { createInput, type InputService } from '../input/Input';
import { createMissionRunner, type MissionRunner } from '../narrative/MissionRunner';
import { getMockMission } from '../narrative/mocks';
import { createCameraRig, type CameraRig } from '../player/CameraRig';
import { createCollisionWorld, type CollisionWorld } from '../player/Collision';
import { createFlightController, type FlightController } from '../player/FlightController';
import { createRenderer, type Renderer } from '../render/Renderer';
import { isBlackIceComposite } from '../render/post/BlackIceComposite';
import type { PersistencePass } from '../render/post/PersistencePass';
import { isVectorCrtPass } from '../render/post/VectorCrtPass';
import type { BeachSim } from '../render/beach/sim';
import { createSimstimFeed, type SimstimFeed } from '../simstim/SimstimFeed';
import { createBeachMode, type BeachMode } from './modes/Beach';
import { createModeStack, type ModeStack } from './ModeStack';

export interface AppOptions {
  root: HTMLElement;
  debug: boolean;
  /** `?lab=` value. `render` / `persist` / `points` / `raster` / `vector` / `grammar` / `sky` / `beach` / `grid` / `heraldry` / `sector` / `simstim` / `teletext` / `text` / `blackice` / `look`. */
  lab?: string | null;
  /** `?quality=` session override; does not write the save. */
  qualityOverride?: QualitySetting;
  /** `?mission=` — mock id, loaded only in dev or with `?debug`. */
  missionId?: string;
  /** `?checkpoint=` — captured or seeked after start. */
  checkpoint?: string;
}

export interface App {
  readonly renderer: Renderer;
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
  readonly simstim: SimstimFeed;
  /** M7.10. Present when Beach mode is on the stack (`?lab=beach` or forceMode). */
  beach?: BeachSim;
  dispose(): void;
}

declare global {
  interface Window {
    /** The running App, exposed under `?debug` and `?lab=` for e2e tests and console poking. */
    __nonspace?: App;
  }
}

/**
 * Bootstrap: a full-window canvas driving the fixed-step loop, mode stack,
 * event bus, save, settings, input, mission runner, flight and the Renderer
 * service (HDR targets + PostChain).
 */
export async function startApp({
  root,
  debug,
  lab,
  qualityOverride,
  missionId,
  checkpoint,
}: AppOptions): Promise<App> {
  const events = createEventBus();
  const save = createSaveStore();
  save.load();
  const settings = createSettingsStore(save.data.settings, (s) => {
    save.data.settings = s;
    save.commit();
  });

  const renderer = createRenderer({ parent: root, settings, qualityOverride });
  const collision = createCollisionWorld();
  const flight = createFlightController({ collision });
  const flyCam = lab === 'sector' || lab === 'look';
  const cameraRig = createCameraRig({
    camera: flyCam ? renderer.cameras.matrix : undefined,
    aspect: window.innerWidth / Math.max(window.innerHeight, 1),
    near: flyCam ? 0.5 : undefined,
    far: flyCam ? 60_000 : undefined,
  });
  const input = createInput({
    settings,
    target: renderer.canvas,
    window,
    document,
  });
  const modeRef: { stack: ModeStack | null } = { stack: null };
  const mission = createMissionRunner({
    events,
    save,
    effects: {
      forceMode(id) {
        const stack = modeRef.stack;
        if (id === 'beach' && stack && !stack.has('beach')) {
          stack.reset(createBeachMode());
        }
      },
    },
  });
  const simstim = createSimstimFeed({ events, mission, renderer });
  const modes = createModeStack({
    events,
    settings,
    save,
    renderer,
    mission,
    input,
    flight,
    simstim,
  });
  modeRef.stack = modes;

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

  const syncRoot = (): void => {
    root.dataset.tier = renderer.quality.tier;
    root.dataset.hdr = renderer.quality.hdr ? '1' : '0';
    root.dataset.scale = renderer.effectiveScale.toFixed(3);
    root.dataset.size = `${renderer.internalWidth}x${renderer.internalHeight}`;
  };

  const loop = createLoop({
    update(dt) {
      const frame = input.sample(dt);
      modes.handleInput(frame);
      if (flightLab || sectorLab || lookLab || lab === 'sky') {
        flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      mission.update(dt);
      simstim.update(dt);
      labHandle?.update(dt);
      sectorLab?.update(dt);
      lookLab?.update(dt);
      modes.update(dt);
      events.flush();
    },
    render(alpha, frameDt) {
      modes.render(alpha);
      if (flightLab) {
        // Flight lab draws with the raw WebGLRenderer and does not use PostChain.
        renderer.three.setRenderTarget(null);
        renderer.three.clear(true, true, false);
        flightLab.render(alpha);
      } else {
        sectorLab?.render(alpha);
        lookLab?.render(alpha);
        renderer.endFrame(frameDt, gpuTimer?.lastMs ?? null);
      }
    },
  });

  const resize = (): void => {
    renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    cameraRig.setAspect(window.innerWidth / Math.max(window.innerHeight, 1));
    syncRoot();
  };
  resize();
  window.addEventListener('resize', resize);

  // rAF stops in background tabs; don't count the hidden time as dropped.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') loop.resetClock();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let labHandle: { update(dt: number): void; dispose(): void } | null = null;
  let sectorLab: { update(dt: number): void; render(alpha: number): void; dispose(): void } | null =
    null;
  let lookLab: { update(dt: number): void; render(alpha: number): void; dispose(): void } | null =
    null;
  if (lab === 'render') {
    const { installRenderLab } = await import('../debug/RenderLab');
    labHandle = installRenderLab(renderer);
    root.dataset.lab = 'render';
  } else if (lab === 'grammar') {
    const { installGrammarLab } = await import('../world/constructs/lab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installGrammarLab(renderer, root, {
      kind: q.get('g') ?? undefined,
      seed: q.get('seed') ?? undefined,
      lod: q.get('lod') ?? undefined,
    });
  } else if (lab === 'heraldry') {
    const { installHeraldryLab } = await import('../content/lab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installHeraldryLab(renderer, root, {
      id: q.get('id') ?? undefined,
      gray: q.get('gray') ?? undefined,
      bpm: q.get('bpm') ?? undefined,
    });
  } else if (lab === 'sector') {
    const { installSectorLab } = await import('../world/lab');
    const q = new URLSearchParams(window.location.search);
    sectorLab = await installSectorLab({
      renderer,
      flight,
      cameraRig,
      root,
      seed: q.get('seed'),
      autofly: q.get('autofly') === '1' || q.get('autofly') === 'true',
    });
  }
  if (lab === 'points') {
    const { installPointsLab } = await import('../debug/PointsLab');
    labHandle = installPointsLab(renderer, root);
    root.dataset.lab = 'points';
  }
  if (lab === 'raster') {
    const { installRasterCrtLab } = await import('../debug/RasterCrtLab');
    labHandle = installRasterCrtLab(renderer);
    root.dataset.lab = 'raster';
  }
  if (lab === 'vector') {
    const { installVectorCrtLab } = await import('../debug/VectorCrtLab');
    labHandle = await installVectorCrtLab(renderer);
    root.dataset.lab = 'vector';
  }
  if (lab === 'simstim') {
    const { installSimstimLab } = await import('../debug/SimstimLab');
    labHandle = installSimstimLab(renderer, simstim, modes);
    root.dataset.lab = 'simstim';
  }

  if (lab === 'sky') {
    const { installSkyLab } = await import('../world/sky/lab');
    labHandle = installSkyLab({
      renderer,
      root,
      flight,
      reduceMotion: () => settings.value.reduceMotion,
    });
    root.dataset.lab = 'sky';
  }

  if (lab === 'teletext') {
    const { installTeletextLab } = await import('../debug/TeletextLab');
    labHandle = installTeletextLab({ renderer, modes, root });
    root.dataset.lab = 'teletext';
  }

  if (lab === 'persist') {
    const { installPersistLab } = await import('../debug/PersistLab');
    labHandle = installPersistLab(renderer);
    root.dataset.lab = 'persist';
  }
  if (lab === 'grid') {
    const { installGridLab, isGridScene } = await import('../debug/GridLab');
    const sceneParam = new URLSearchParams(window.location.search).get('scene');
    labHandle = installGridLab(renderer, root, {
      scene: isGridScene(sceneParam) ? sceneParam : undefined,
    });
    root.dataset.lab = 'grid';
  }
  if (lab === 'blackice') {
    const { installBlackIceLab, isBlackIceScene } = await import('../debug/BlackIceLab');
    const q = new URLSearchParams(window.location.search);
    const sceneParam = q.get('scene');
    labHandle = installBlackIceLab(renderer, root, {
      scene: isBlackIceScene(sceneParam) ? sceneParam : undefined,
      grip: q.get('grip') ?? undefined,
    });
  }
  if (lab === 'look') {
    const { installLookLab } = await import('../debug/LookLab');
    const q = new URLSearchParams(window.location.search);
    lookLab = installLookLab({
      renderer,
      flight,
      cameraRig,
      root,
      gray: q.get('gray'),
    });
  }

  let inputLab: { dispose(): void } | null = null;
  if (lab === 'input') {
    const { createInputLab } = await import('../input/InputLab');
    inputLab = createInputLab(input, settings, root);
  }

  let flightLab: { render(alpha: number): void; dispose(): void } | null = null;
  if (lab === 'flight') {
    const { createFlightLab } = await import('../player/FlightLab');
    flightLab = createFlightLab({ renderer: renderer.three, flight, cameraRig, root });
  }

  let beachMode: BeachMode | null = null;
  if (lab === 'beach') {
    beachMode = createBeachMode({ lab: true });
    modes.reset(beachMode);
    root.dataset.lab = 'beach';
  }

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (debug || lab === 'look') {
    gpuTimer = createGpuTimer(renderer.three.getContext() as WebGL2RenderingContext);
  }
  if (debug) {
    const { createDebugGui } = await import('../debug/DebugGui');
    gui = createDebugGui({ gpuTimerAvailable: gpuTimer !== null });
    renderer.attachDebug(gui.pane);
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
    const stim = gui.pane.addFolder({ title: 'simstim' });
    stim.addBinding(simstim.debug, 'clock', { readonly: true });
    stim.addBinding(simstim.debug, 'meatTime', {
      readonly: true,
      label: 'meat',
      format: (v: number) => v.toFixed(2),
    });
    stim.addBinding(simstim.debug, 'flipped', { readonly: true });
    stim.addBinding(simstim.debug, 'lag', { readonly: true, format: (v: number) => v.toFixed(2) });
    stim.addBinding(simstim.debug, 'pain', { readonly: true, format: (v: number) => v.toFixed(2) });
    stim.addBinding(simstim.debug, 'neural', {
      readonly: true,
      format: (v: number) => v.toFixed(1),
    });
    const vectorPass = renderer.chain.vectorCrt;
    if (isVectorCrtPass(vectorPass)) {
      const crt = gui.pane.addFolder({ title: 'vector CRT' });
      crt.addBinding(vectorPass.params, 'enableBarrel', { label: 'barrel' });
      crt.addBinding(vectorPass.params, 'enableJitter', { label: 'jitter' });
      crt.addBinding(vectorPass.params, 'enableFlicker', { label: 'flicker' });
      crt.addBinding(vectorPass.params, 'enableVignette', { label: 'vignette' });
      crt.addBinding(vectorPass.params, 'enableGlass', { label: 'glass' });
      crt.addBinding(vectorPass.params, 'enableGrain', { label: 'grain' });
      crt.addBinding(vectorPass.params, 'barrel', { min: 0, max: 0.05, step: 0.001 });
      crt.addBinding(vectorPass.params, 'jitter', {
        min: 0,
        max: 0.25,
        step: 0.01,
        label: 'jitter px',
      });
      crt.addBinding(vectorPass.params, 'flicker', {
        min: 0,
        max: 0.03,
        step: 0.001,
        label: 'flicker amp',
      });
      crt.addBinding(vectorPass.params, 'vignette', { min: 0, max: 1, step: 0.01 });
      crt.addBinding(vectorPass.params, 'glass', { min: 0, max: 1, step: 0.01 });
      crt.addBinding(vectorPass.params, 'grain', { min: 0, max: 0.2, step: 0.005 });
      crt.addBinding(vectorPass, 'effectiveFlicker', {
        readonly: true,
        label: 'flicker now',
        format: (v: number) => v.toFixed(3),
      });
      const load = { vectorLoad: renderer.vectorLoad };
      crt
        .addBinding(load, 'vectorLoad', { min: 0, max: 1, step: 0.01, label: 'vector load' })
        .on('change', (ev) => {
          renderer.vectorLoad = Number(ev.value) || 0;
        });
    }
    const phosphorPass = renderer.chain.getPass('persistence') as PersistencePass;
    if ('decayScale' in phosphorPass) {
      const phos = gui.pane.addFolder({ title: 'phosphor' });
      phos.addBinding(phosphorPass, 'decayScale', {
        min: 0,
        max: 4,
        step: 0.05,
        label: 'decay scale',
      });
      phos.addBinding(phosphorPass, 'shift', { min: 0, max: 1, step: 0.01 });
      phos.addBinding(phosphorPass, 'smearThreshold', {
        min: 0,
        max: 8,
        step: 0.05,
        label: 'smear ω',
      });
      phos.addBinding(phosphorPass, 'smearStrength', {
        min: 0,
        max: 8,
        step: 0.05,
        label: 'smear k',
      });
    }
    beachMode?.attachDebug(gui.pane);
    const icePass = renderer.chain.getPass('blackIce');
    if (isBlackIceComposite(icePass)) {
      const ice = gui.pane.addFolder({ title: 'black ice' });
      ice.addBinding(icePass, 'strength', { min: 0, max: 1, step: 0.01 });
      ice.addBinding(icePass, 'edgeIntensity', { min: 0, max: 4, step: 0.05, label: 'UV edge' });
      ice.addBinding(icePass, 'grip', { min: 0, max: 1, step: 0.01 });
    }
  }

  let last = performance.now();
  let firstFrame = true;

  const frame = (now: number): void => {
    const dt = now - last;
    last = now;

    gpuTimer?.begin();
    loop.frame(now);
    gpuTimer?.end();
    const gpuMs = gpuTimer ? gpuTimer.poll() : null;

    if (gui) gui.frame(dt, gpuMs);
    if (lab === 'look') root.dataset.gpuMs = gpuMs == null ? 'n/a' : gpuMs.toFixed(2);
    if (firstFrame) {
      firstFrame = false;
      root.dataset.status = 'running';
      syncRoot();
    }
  };
  renderer.three.setAnimationLoop(frame);

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
    simstim,
    dispose() {
      renderer.three.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      labHandle?.dispose();
      sectorLab?.dispose();
      lookLab?.dispose();
      modes.reset();
      simstim.dispose();
      mission.dispose();
      events.clear();
      inputLab?.dispose();
      flightLab?.dispose();
      cameraRig.dispose();
      input.dispose();
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      if (window.__nonspace === app) delete window.__nonspace;
    },
  };
  if (beachMode) app.beach = beachMode.sim;
  if (debug || lab) window.__nonspace = app;
  return app;
}
