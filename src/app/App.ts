import type { NeuromancerAction } from '../ai/Neuromancer';
import type { WintermuteAction } from '../ai/Wintermute';
import { createEventBus, type EventBus } from '../core/events';
import { createLoop, type Loop } from '../core/loop';
import { createSaveStore, type SaveStore } from '../core/save';
import { createSettingsStore, type SettingsStore, type QualitySetting } from '../core/settings';
import type { DebugGui } from '../debug/DebugGui';
import { createGpuTimer, type GpuTimer } from '../debug/gpuTimer';
import { createInput, type InputService } from '../input/Input';
import {
  createMissionRunner,
  type MissionEffects,
  type MissionRunner,
} from '../narrative/MissionRunner';
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
import type { BeachMode } from './modes/Beach';
import { createModeStack, type ModeStack } from './ModeStack';

export interface AppOptions {
  root: HTMLElement;
  debug: boolean;
  /** `?lab=` value. `render` / `persist` / `points` / `raster` / `vector` / `grammar` / `sky` / `beach` / `grid` / `heraldry` / `sector` / `simstim` / `teletext` / `text` / `blackice` / `look` / `jack` / `ice` / `hud` / `breach` / `deck` / `watchers` / `core` / `phaselock3d` / `softs` / `ai` / `jump` / `kuang` / `dive` / `dixie`. */
  lab?: string | null;
  /** `?quality=` session override; does not write the save. */
  qualityOverride?: QualitySetting;
  /** `?mission=` — mock id, loaded only in dev or with `?debug` (m7 also in preview; p0–m6 always). */
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
  const sliceMission =
    missionId === 'p0' ||
    missionId === 'm1' ||
    missionId === 'm2' ||
    missionId === 'm3' ||
    missionId === 'm4' ||
    missionId === 'm5';
  const beachMission = missionId === 'm6';
  const flyCam =
    lab === 'sector' || lab === 'look' || lab === 'ai' || lab === 'jump' || sliceMission;
  const cameraRig = createCameraRig({
    camera: flyCam ? renderer.cameras.matrix : undefined,
    aspect: window.innerWidth / Math.max(window.innerHeight, 1),
    near: flyCam ? 0.5 : undefined,
    far: flyCam ? (sliceMission ? 80_000 : 60_000) : undefined,
  });
  const input = createInput({
    settings,
    target: renderer.canvas,
    window,
    document,
  });
  const modeRef: { stack: ModeStack | null } = { stack: null };
  type AiPresenceHandle = {
    applyWintermute(action: WintermuteAction): void;
    applyNeuromancer(action: NeuromancerAction): void;
    update(dt: number): void;
    reset(): void;
    dispose(): void;
  };
  let aiPresence: AiPresenceHandle | null = null;
  let ensureAi: () => Promise<AiPresenceHandle> = async () => {
    throw new Error('AI presence not ready');
  };
  const sliceFx: { current: MissionEffects | null } = { current: null };
  type SliceRun = {
    update(dt: number): void;
    render(alpha: number): void;
    dispose(): void;
    beach?: BeachSim;
  };
  const sliceRef: { current: SliceRun | null } = { current: null };
  const mission = createMissionRunner({
    events,
    save,
    effects: {
      forceMode(id) {
        if (id === 'beach') {
          sliceFx.current?.forceMode?.(id);
          const stack = modeRef.stack;
          if (!stack) return;
          void import('../campaign/enterBeach').then(({ enterBeach }) =>
            enterBeach({
              root,
              renderer,
              events,
              save,
              settings,
              input,
              modes: stack,
              mission,
              effectsSlot: sliceFx,
              source: 'm5',
            }).then((run) => {
              if (!sliceRef.current) sliceRef.current = run;
            }),
          );
          return;
        }
        sliceFx.current?.forceMode?.(id);
      },
      say(who, line) {
        sliceFx.current?.say?.(who, line);
      },
      iceMod(iceId, patch) {
        sliceFx.current?.iceMod?.(iceId, patch);
      },
      ink(knot) {
        sliceFx.current?.ink?.(knot);
      },
      music(state) {
        sliceFx.current?.music?.(state);
      },
      sfx(id) {
        sliceFx.current?.sfx?.(id);
      },
      wintermute(action) {
        if (sliceFx.current?.wintermute) {
          sliceFx.current.wintermute(action);
          return;
        }
        void ensureAi().then((p) => p.applyWintermute(action));
      },
      neuromancer(action) {
        void ensureAi().then((p) => p.applyNeuromancer(action));
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
  ensureAi = async () => {
    if (aiPresence) return aiPresence;
    const { createAiPresence } = await import('../debug/AiLab');
    aiPresence = createAiPresence({
      renderer,
      flight,
      save,
      events,
      modes,
    });
    return aiPresence;
  };

  const stimMission = missionId === 'm7';
  const allowMissionRoute =
    debug || import.meta.env.DEV || stimMission || sliceMission || beachMission;
  if (allowMissionRoute && missionId && !sliceMission && !beachMission) {
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
      if (flightLab || sectorLab || lookLab || lab === 'sky' || lab === 'ai') {
        flight.step(frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      aiPresence?.update(dt);
      mission.update(dt);
      simstim.update(dt);
      labHandle?.update(dt);
      sectorLab?.update(dt);
      lookLab?.update(dt);
      jumpLab?.update(dt);
      sliceRef.current?.update(dt);
      modes.update(dt);
      events.flush();
    },
    render(alpha, frameDt) {
      modes.render(alpha);
      sliceRef.current?.render(alpha);
      if (flightLab) {
        // Flight lab draws with the raw WebGLRenderer and does not use PostChain.
        renderer.three.setRenderTarget(null);
        renderer.three.clear(true, true, false);
        flightLab.render(alpha);
      } else {
        sectorLab?.render(alpha);
        lookLab?.render(alpha);
        jumpLab?.render(alpha);
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
  let jumpLab: { update(dt: number): void; render(alpha: number): void; dispose(): void } | null =
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
  if (lab === 'simstim' || stimMission) {
    const { installSimstimLab } = await import('../debug/SimstimLab');
    const q = new URLSearchParams(window.location.search);
    const seekRaw = Number.parseFloat(q.get('t') ?? '');
    const missionScene = missionId === 'm7' ? 'straylight-m7' : 'sensenet';
    labHandle = installSimstimLab(renderer, simstim, modes, {
      scene: q.get('scene') ?? (stimMission ? missionScene : undefined),
      mission: stimMission ? mission : undefined,
      seek: Number.isFinite(seekRaw) && seekRaw > 0 ? seekRaw : undefined,
    });
    if (lab === 'simstim') root.dataset.lab = 'simstim';
    if (stimMission && missionId) root.dataset.mission = missionId;
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
  if (lab === 'jack') {
    const { installJackLab } = await import('../debug/JackLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installJackLab({
      renderer,
      modes,
      events,
      save,
      settings,
      root,
      seq: q.get('seq'),
      scene: q.get('scene'),
      first: q.get('first'),
    });
  }
  if (lab === 'ice') {
    const { installIceLab } = await import('../debug/IceLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installIceLab({
      renderer,
      root,
      scene: q.get('scene'),
      gray: q.get('gray'),
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'hud') {
    const { installHudLab } = await import('../debug/HudLab');
    labHandle = installHudLab({
      renderer,
      events,
      root,
      reduceFlashing: () => settings.value.reduceFlashing,
    });
  }
  if (lab === 'breach') {
    const { installBreachLab } = await import('../debug/BreachLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installBreachLab({
      renderer,
      events,
      save,
      settings,
      input,
      flight,
      modes,
      root,
      scene: q.get('scene'),
      reduceFlashing: () => settings.value.reduceFlashing,
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'watchers') {
    const { installWatcherLab } = await import('../debug/WatcherLab');
    labHandle = installWatcherLab({
      renderer,
      events,
      root,
      reduceFlashing: () => settings.value.reduceFlashing,
    });
  }
  if (lab === 'deck') {
    const { installDeckLab } = await import('../debug/DeckLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installDeckLab({
      renderer,
      modes,
      events,
      settings,
      save,
      input,
      loop,
      root,
      scene: q.get('scene'),
    });
  }
  if (lab === 'core') {
    const { installCoreLab } = await import('../debug/CoreLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = await installCoreLab({
      renderer,
      events,
      save,
      settings,
      input,
      flight,
      modes,
      root,
      scene: q.get('scene'),
      seed: q.get('seed'),
      reduceFlashing: () => settings.value.reduceFlashing,
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'phaselock3d' || lab === 'softs') {
    const { installSoftsLab } = await import('../debug/SoftsLab');
    const q = new URLSearchParams(window.location.search);
    labHandle = installSoftsLab({
      renderer,
      events,
      save,
      settings,
      input,
      flight,
      root,
      scene: q.get('scene') ?? q.get('soft'),
      reduceFlashing: () => settings.value.reduceFlashing,
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'ai') {
    const { installAiLab, isAiScene } = await import('../debug/AiLab');
    const q = new URLSearchParams(window.location.search);
    const sceneParam = q.get('scene');
    labHandle = installAiLab({
      renderer,
      flight,
      cameraRig,
      events,
      save,
      modes,
      root,
      scene: isAiScene(sceneParam) ? sceneParam : undefined,
      reduceFlashing: () => settings.value.reduceFlashing,
    });
  }
  if (lab === 'jump') {
    const { installJumpLab } = await import('../debug/JumpLab');
    const q = new URLSearchParams(window.location.search);
    jumpLab = installJumpLab({
      renderer,
      flight,
      cameraRig,
      modes,
      input,
      root,
      scene: q.get('scene'),
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'kuang' || lab === 'dive') {
    const { installKuangLab, isKuangScene } = await import('../debug/KuangLab');
    const q = new URLSearchParams(window.location.search);
    const sceneParam = lab === 'dive' && !q.get('scene') ? 'dive' : q.get('scene');
    labHandle = installKuangLab({
      renderer,
      events,
      settings,
      input,
      modes,
      root,
      scene: isKuangScene(sceneParam) ? sceneParam : undefined,
      reduceFlashing: () => settings.value.reduceFlashing,
      reduceMotion: () => settings.value.reduceMotion,
    });
  }
  if (lab === 'dixie') {
    const { installDixieLab } = await import('../debug/DixieLab');
    labHandle = installDixieLab({
      renderer,
      events,
      save,
      input,
      root,
      reduceFlashing: () => settings.value.reduceFlashing,
    });
  }

  if (beachMission && !lab) {
    const { enterBeach } = await import('../campaign/enterBeach');
    try {
      sliceRef.current = await enterBeach({
        root,
        renderer,
        events,
        save,
        settings,
        input,
        modes,
        mission,
        checkpoint,
        effectsSlot: sliceFx,
        source: 'm6',
      });
    } catch (err) {
      console.error('[nonspace] enterBeach failed', err);
      throw err;
    }
  } else if (sliceMission && !lab) {
    const bootSlice = {
      root,
      renderer,
      events,
      save,
      settings,
      input,
      flight,
      cameraRig,
      modes,
      mission,
      checkpoint,
      effectsSlot: sliceFx,
    };
    const startM2 = async (): Promise<void> => {
      sliceRef.current?.dispose();
      sliceRef.current = null;
      const { startSenseNetMission } = await import('../campaign/senseNet');
      sliceRef.current = await startSenseNetMission({ ...bootSlice, simstim });
    };
    if (missionId === 'm5') {
      const { startKuangGradeMission } = await import('../campaign/kuangGrade');
      sliceRef.current = await startKuangGradeMission({ ...bootSlice, simstim });
    } else if (missionId === 'm4') {
      const { startTuringMission } = await import('../campaign/turing');
      sliceRef.current = await startTuringMission(bootSlice);
    } else if (missionId === 'm3') {
      const { startConstructMission } = await import('../campaign/construct');
      sliceRef.current = await startConstructMission(bootSlice);
    } else if (missionId === 'm2') {
      await startM2();
    } else {
      const { startVerticalSlice } = await import('../campaign/verticalSlice');
      sliceRef.current = await startVerticalSlice({
        ...bootSlice,
        missionId: missionId === 'm1' ? 'm1' : 'p0',
        onContinueToM2: startM2,
      });
    }
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
    const { createBeachMode } = await import('./modes/Beach');
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
    const aiFold = gui.pane.addFolder({ title: 'AI' });
    type AiButtons = {
      applyWintermute(action: WintermuteAction): void;
      applyNeuromancer(action: NeuromancerAction): void;
      reset(): void;
    };
    const pickAi = async (): Promise<AiButtons> => {
      const lab = (window as unknown as { __nonspaceAi?: AiButtons }).__nonspaceAi;
      if (lab) return lab;
      const p = await ensureAi();
      return {
        applyWintermute(action) {
          events.post({ type: 'wintermute', action });
          p.applyWintermute(action);
        },
        applyNeuromancer(action) {
          events.post({ type: 'neuromancer', action });
          p.applyNeuromancer(action);
        },
        reset() {
          p.reset();
        },
      };
    };
    const onAi = (fn: (p: AiButtons) => void): void => {
      void pickAi().then(fn);
    };
    aiFold.addButton({ title: 'overexpose' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'overexpose', amount: 1 }));
    });
    aiFold.addButton({ title: 'persona' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'persona', who: 'finn', on: true }));
    });
    aiFold.addButton({ title: 'hijack' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'hijack', text: 'WINTERMUTE> I NEED A RIDER' }));
    });
    aiFold.addButton({ title: 'freeze' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'freeze', on: true }));
    });
    aiFold.addButton({ title: 'grid bend' }).on('click', () => {
      onAi((p) =>
        p.applyWintermute({
          kind: 'gridBend',
          points: [
            { x: -48, z: 40, strength: 0.8 },
            { x: 48, z: 40, strength: 0.8 },
            { x: -56, z: -90, strength: 0.68 },
            { x: 56, z: -90, strength: 0.68 },
          ],
        }),
      );
    });
    aiFold.addButton({ title: 'phones' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'ringPhones', on: true }));
    });
    aiFold.addButton({ title: 'bargain' }).on('click', () => {
      onAi((p) => p.applyWintermute({ kind: 'bargain', offerId: 'opens-the-door', debt: 1 }));
    });
    aiFold.addButton({ title: 'soften' }).on('click', () => {
      onAi((p) => p.applyNeuromancer({ kind: 'soften', amount: 1 }));
    });
    aiFold.addButton({ title: 'pull' }).on('click', () => {
      onAi((p) =>
        p.applyNeuromancer({ kind: 'pull', target: { x: 0, y: 16, z: 8 }, strength: 40 }),
      );
    });
    aiFold.addButton({ title: 'beach' }).on('click', () => {
      onAi((p) => p.applyNeuromancer({ kind: 'beach' }));
    });
    aiFold.addButton({ title: 'reset AI' }).on('click', () => {
      onAi((p) => p.reset());
    });
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
  // Playwright sets navigator.webdriver. Do not start a live HUD+CRT rAF for
  // ?lab=dixie / ?mission=m3|m4|m5|m6 — that billed sibling SwiftShader loop.spec / sector.spec.
  const webdriver = typeof navigator !== 'undefined' && navigator.webdriver;
  if (
    webdriver &&
    (lab === 'dixie' ||
      missionId === 'm3' ||
      missionId === 'm4' ||
      missionId === 'm5' ||
      missionId === 'm6')
  ) {
    root.dataset.status = 'running';
    syncRoot();
  } else {
    renderer.three.setAnimationLoop(frame);
  }

  let publishedBeach: BeachSim | undefined;
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
    get beach() {
      return publishedBeach ?? beachMode?.sim ?? sliceRef.current?.beach;
    },
    set beach(sim) {
      publishedBeach = sim;
    },
    dispose() {
      renderer.three.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      labHandle?.dispose();
      sectorLab?.dispose();
      lookLab?.dispose();
      aiPresence?.dispose();
      aiPresence = null;
      jumpLab?.dispose();
      sliceRef.current?.dispose();
      sliceRef.current = null;
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
  if (debug || lab || missionId) window.__nonspace = app;
  return app;
}
