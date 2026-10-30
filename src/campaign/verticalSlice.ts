import { createBreachMode } from '../app/modes/Breach';
import { createCoreMode } from '../app/modes/Core';
import { createDeckPanelMode, DEFAULT_ADDRESS_BOOK } from '../app/modes/DeckPanel';
import { createFlatlineMode, FLATLINE_TIMING, type FlatlineMode } from '../app/modes/Flatline';
import { createInterludeMode } from '../app/modes/Interlude';
import { createJackInMode, type JackInMode } from '../app/modes/JackIn';
import { createJackOutMode, type JackOutMode } from '../app/modes/JackOut';
import { createMatrixMode } from '../app/modes/Matrix';
import type { ModeStack } from '../app/ModeStack';
import { SFX_IDS, type AudioEngine, type SfxId } from '../audio/AudioEngine';
import { bindSfxToEvents } from '../audio/sfx/bind';
import { createBreachController, JACK_OUT_HOLD, type IceAnchor } from '../breach/BreachController';
import { createCoreInterior, type CoreInterior } from '../breach/CoreInterior';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { createIceModel, type IceModel } from '../breach/IceModel';
import { WHITE_ICE } from '../content/ice/white';
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { isCampaignMissionId, loadCampaignMission } from '../content/missions/load';
import { M1_ICE_ID, M1_LOOK_S, M1_RECORD, M1_START } from '../content/missions/m1';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createHud, type Hud } from '../hud/Hud';
import type { InputFrame, InputService } from '../input/Input';
import { createInterlude, type Interlude } from '../meat/Interlude';
import type { InkStory } from '../narrative/InkRuntime';
import type { MissionEffects, MissionRunner } from '../narrative/MissionRunner';
import {
  createCoordinateJump,
  jumpArrival,
  jumpFailMessage,
  type CoordinateJump,
} from '../player/CoordinateJump';
import { poseFromForward, type FlightController } from '../player/FlightController';
import type { CameraRig } from '../player/CameraRig';
import { sphereHull } from '../player/Collision';
import { createJumpStreak, sampleJumpStreak } from '../render/fx/JumpStreak';
import type { PersistencePass } from '../render/post/PersistencePass';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';
import { loadHersheyFont, type HersheyFont } from '../render/text/HersheyText';
import { formatMatrixCoord, matrixCoordToWorld, worldToMatrixCoord } from '../world/coords';
import { createChibaScene } from './chibaScene';
import { createTutorialPrompts, type TutorialPhase, type TutorialPrompts } from './tutorialPrompts';
import p0Ink from '../content/ink/p0.json';
import m1Ink from '../content/ink/m1.json';

export interface SliceHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: TutorialPhase;
  knot: string | null;
  ended: boolean;
  won: boolean;
  scanned: boolean;
  engaged: boolean;
  downloaded: boolean;
  neural: number;
  trace: number;
  coords: string;
  skipJackIn(): void;
  skipLook(): void;
  choose(n: number): boolean;
  scan(): void;
  jumpToChiba(): boolean;
  completeJump(): void;
  engage(): boolean;
  crack(): void;
  completeDownload(): void;
  jackOut(): void;
  skipOverlay(): void;
  forceFlatline(): void;
  forceBurned(): void;
  advance(dt: number): void;
  paint(): void;
}

export interface VerticalSlice {
  readonly handle: SliceHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface VerticalSliceOptions {
  root: HTMLElement;
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  input: InputService;
  flight: FlightController;
  cameraRig: CameraRig;
  modes: ModeStack;
  mission: MissionRunner;
  missionId: 'p0' | 'm1';
  checkpoint?: string;
  /** App assigns this before `mission.start()` so say/music/sfx land on HUD/audio. */
  effectsSlot: { current: MissionEffects | null };
  /** M1 debrief → M2 (M7.5). */
  onContinueToM2?: () => void | Promise<void>;
}

declare global {
  interface Window {
    __nonspaceMission?: SliceHandle;
  }
}

const FWD = { x: 0, y: 0, z: -1 };
const LOOK = { yaw: 0, pitch: 0 };

function clinicWorld(): { x: number; y: number; z: number } {
  const def = getLandmark('chiba-node');
  return def ? landmarkWorldPos(def.coords) : { x: 0, y: 160, z: 0 };
}

function startWorld(): { x: number; y: number; z: number } {
  return matrixCoordToWorld(M1_START);
}

export async function startVerticalSlice(opts: VerticalSliceOptions): Promise<VerticalSlice> {
  const {
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
    missionId,
  } = opts;

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.45;
  renderer.cameras.hud.near = 0.1;
  renderer.cameras.hud.far = 10;
  renderer.cameras.hud.updateProjectionMatrix();
  renderer.cameras.matrix.near = 0.5;
  renderer.cameras.matrix.far = 80_000;
  renderer.cameras.matrix.updateProjectionMatrix();

  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  pass.params.enableBarrel = true;
  pass.params.enableJitter = false;
  pass.params.enableFlicker = false;
  pass.params.enableGrain = true;
  pass.params.enableVignette = true;

  const persist = renderer.chain.getPass('persistence') as PersistencePass;

  let audio: AudioEngine | null = null;
  let unbindAudio: (() => void) | null = null;
  try {
    const { createAudioEngine } = await import('../audio/AudioEngine');
    audio = createAudioEngine({ settings });
    unbindAudio = bindSfxToEvents(events, audio);
    (modes.ctx as { audio?: AudioEngine }).audio = audio;
  } catch {
    audio = null;
  }

  const hud: Hud = createHud({
    renderer,
    events,
    reduceFlashing: () => settings.value.reduceFlashing,
  });
  hud.setPipLink(false);
  hud.setMode('TRANSIT');

  const scene = createChibaScene(renderer, flight.collision);
  scene.setVisible(false);
  const icePos = clinicWorld();
  flight.collision.add(sphereHull('m1-ice', 'ice', icePos.x, icePos.y, icePos.z, 14));

  const iceAnchor = (): IceAnchor => ({
    def: WHITE_ICE,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: 7,
  });

  let displayIce: IceModel = createIceModel(WHITE_ICE, { seed: 7 });
  let visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: WHITE_ICE,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const breach = createBreachController({ events, save, audio: audio ?? undefined });
  breach.neural.reset(8);
  breach.trace.reset(4);
  breach.markCheckpoint();

  let interior: CoreInterior | null = null;
  let jackIn: JackInMode | null = null;
  let jackOutMode: JackOutMode | null = null;
  let flatlineMode: FlatlineMode | null = null;
  let interlude: Interlude | null = null;
  let region = missionId === 'p0' ? 'CHBA' : 'BAMA';
  let scanned = false;
  let downloaded = false;
  let ended = false;
  let disposed = false;
  let chaining = false;

  const font: HersheyFont | null = await loadHersheyFont('/fonts/hershey/simplex.bin.gz').catch(
    () => null,
  );
  const prompts: TutorialPrompts = createTutorialPrompts(renderer, font);
  prompts.setAnchor(icePos.x, icePos.y, icePos.z);
  prompts.batch.object.visible = false;

  const streak = createJumpStreak({ palette: renderer.palette, scene: renderer.scenes.matrix });

  const jump: CoordinateJump = createCoordinateJump({
    flight,
    gripped: () => breach.grip.active,
    inCore: () => modes.has('core'),
    trace: () => breach.trace.value,
    reduceMotion: () => settings.value.reduceMotion,
    onStart: () => audio?.sfx('jump'),
    onArrive: (coord) => {
      region = coord.region;
      audio?.sfx('jumpArrive');
      hud.print(`ARRIVE ${formatMatrixCoord(coord)}`);
    },
  });

  const player = (): { x: number; y: number; z: number } => ({
    x: flight.pose.x,
    y: flight.pose.y,
    z: flight.pose.z,
  });
  const look = (): { x: number; y: number; z: number } => flight.forward(FWD);

  const liveIce = (): IceModel => breach.ice ?? displayIce;

  const tutorialPhase = (): TutorialPhase => {
    if (modes.has('core')) return 'core';
    if (breach.engaged) return 'breach';
    const d = Math.hypot(
      flight.pose.x - icePos.x,
      flight.pose.y - icePos.y,
      flight.pose.z - icePos.z,
    );
    if (d < 420) return 'approach';
    if (scanned) return 'jump';
    if (mission.flag('looked') || mission.time >= M1_LOOK_S) return 'scan';
    return 'look';
  };

  const paintHud = (): void => {
    const p = player();
    const coord = worldToMatrixCoord(p.x, p.y, p.z, region);
    hud.setCoords(formatMatrixCoord(coord));
    hud.setSpeed(flight.telemetry.speed);
    hud.setNeural(breach.neural.value);
    hud.setTrace(breach.trace.value);
    hud.setScars(breach.neural.scars);
    hud.setFlatline(modes.has('flatline'));
    if (breach.grip.active) {
      hud.setMode('GRIP');
      hud.setGrip(breach.grip.remaining);
    } else if (modes.has('core')) {
      hud.setMode(interior?.phase === 'routeOut' ? 'EXFIL' : 'CORE');
      hud.setGrip(null);
      hud.setLock(null);
    } else if (breach.engaged) {
      hud.setMode('BREACH');
      hud.setGrip(null);
    } else if (jump.active) {
      hud.setMode('JUMP');
      hud.setGrip(null);
      hud.setLock(null);
    } else {
      hud.setMode(tutorialPhase() === 'approach' ? 'APPROACH' : 'TRANSIT');
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
    const blips = scene.landmarks.map((lm) => {
      const dx = lm.x - p.x;
      const dz = lm.z - p.z;
      const dist = Math.hypot(dx, dz);
      return {
        angle: Math.atan2(dz, dx),
        radius: Math.min(1, dist / 4000),
        kind: (lm.id === 'chiba-node' ? 'ice' : 'target') as 'ice' | 'target',
      };
    });
    hud.setBlips(blips);
    hud.update(0);
  };

  const applyFx = (): void => {
    const sample = sampleJumpStreak(jump.phase, jump.streakU, settings.value.reduceMotion);
    if (persist && 'decayScale' in persist) persist.decayScale = sample.decayScale;
    const dest = jump.targetWorld ?? icePos;
    streak.update(flight.pose, dest, sample, {
      w: renderer.internalWidth,
      h: renderer.internalHeight,
    });
  };

  const overlayPaint = (): boolean => {
    const id = modes.top?.id;
    return id === 'interlude' || id === 'jackIn' || id === 'jackOut' || id === 'flatline';
  };

  const syncHudVis = (): void => {
    const id = modes.top?.id;
    renderer.scenes.hud.visible = id !== 'interlude' && id !== 'jackIn' && id !== 'jackOut';
  };

  const paintWorld = (alpha = 1): void => {
    cameraRig.apply(flight, alpha);
    const cam = renderer.cameras.matrix.position;
    scene.follow(cam, renderer.quality.latticeRadius);
    prompts.phase = tutorialPhase();
    prompts.update({ x: cam.x, y: cam.y, z: cam.z });
    interior?.paint();
    applyFx();
    paintHud();
  };

  const dropOverlay = (): void => {
    while (
      modes.top &&
      (modes.top.id === 'deckPanel' ||
        modes.top.id === 'breach' ||
        modes.top.id === 'core' ||
        modes.top.id === 'flatline' ||
        modes.top.id === 'jackOut' ||
        modes.top.id === 'jackIn' ||
        modes.top.id === 'interlude' ||
        modes.top.id === 'boot')
    ) {
      modes.pop();
    }
  };

  const pushMatrix = (): void => {
    if (modes.has('matrix')) return;
    modes.reset(
      createMatrixMode({
        onInput: onMatrixInput,
        onUpdate: () => {},
        onRender: () => {},
      }),
    );
    renderer.postMode = 'matrix';
    scene.setVisible(true);
    if (visuals) visuals.object.visible = true;
    prompts.batch.object.visible = true;
  };

  const poseAtStart = (): void => {
    const from = startWorld();
    const esfa = getLandmark('esfa');
    const target = esfa ? landmarkWorldPos(esfa.coords) : { x: from.x - 80, y: from.y, z: from.z };
    poseFromForward(target.x - from.x, target.y - from.y, target.z - from.z, LOOK);
    flight.setPose({
      x: from.x,
      y: from.y,
      z: from.z,
      yaw: LOOK.yaw,
      pitch: LOOK.pitch,
      vx: 0,
      vy: 0,
      vz: 0,
      bank: 0,
      fov: flight.params.fovBase,
    });
    region = 'BAMA';
  };

  const poseAtChiba = (): void => {
    const arr = jumpArrival(startWorld(), icePos);
    flight.setPose({
      x: arr.x,
      y: arr.y,
      z: arr.z,
      yaw: arr.yaw,
      pitch: arr.pitch,
      vx: 0,
      vy: 0,
      vz: 0,
      fov: flight.params.fovBase,
    });
    region = 'CHBA';
    mission.setPlayerPosition(arr.x, arr.y, arr.z);
  };

  const enterCore = (): void => {
    if (interior) return;
    visuals?.shatter(7);
    if (visuals) visuals.object.visible = false;
    scene.setVisible(false);
    prompts.batch.object.visible = false;
    interior = createCoreInterior({
      events,
      trace: breach.trace,
      heat: breach.heat,
      def: { seed: 7, strata: 6, targetRecord: M1_RECORD, layers: 1, downloadHold: 3 },
    });
    interior.attach(renderer);
    const t = interior.layout.target;
    poseFromForward(t.cx - (t.cx + 16), t.cy - (t.cy + 6), t.cz - (t.cz + 22), LOOK);
    flight.setPose({
      x: t.cx + 16,
      y: t.cy + 6,
      z: t.cz + 22,
      yaw: LOOK.yaw,
      pitch: LOOK.pitch,
      vx: 0,
      vy: 0,
      vz: 0,
      fov: flight.params.fovBase,
    });
    renderer.cameras.matrix.far = 400;
    renderer.cameras.matrix.updateProjectionMatrix();
    dropOverlay();
    if (!modes.has('matrix')) pushMatrix();
    modes.push(
      createCoreMode({
        interior,
        hud,
        flight,
        reduceMotion: () => settings.value.reduceMotion,
        onDownloaded() {
          downloaded = true;
        },
        onJackOut() {
          beginJackOut('player');
        },
        onBurned() {
          beginJackOut('burned');
        },
      }),
    );
    hud.print('CORE OPEN');
  };

  const beginJackOut = (reason: 'player' | 'burned' | 'script'): void => {
    dropOverlay();
    jackOutMode = createJackOutMode({
      reason,
      onDone() {
        jackOutMode = null;
        if (reason === 'burned') {
          retryFromCheckpoint();
          return;
        }
        if (mission.def?.id === 'm1') {
          void showDebrief();
        }
      },
    });
    modes.push(jackOutMode);
  };

  const retryFromCheckpoint = (): void => {
    dropOverlay();
    interior?.dispose();
    interior = null;
    downloaded = false;
    renderer.cameras.matrix.far = 80_000;
    renderer.cameras.matrix.updateProjectionMatrix();
    const cp = mission.checkpointId;
    if (cp === 'chiba' || cp === 'core' || cp === 'take') poseAtChiba();
    else poseAtStart();
    breach.restoreCheckpoint();
    displayIce = createIceModel(WHITE_ICE, { seed: 7 });
    visuals?.dispose();
    visuals = createIceVisuals({
      renderer,
      def: WHITE_ICE,
      x: icePos.x,
      y: icePos.y,
      z: icePos.z,
    });
    scene.setVisible(true);
    pushMatrix();
    hud.print('RETRY');
    hud.setFlatline(false);
  };

  const startFlatline = (scripted: boolean): void => {
    dropOverlay();
    flatlineMode = createFlatlineMode({
      breach,
      scripted,
      onDone() {
        flatlineMode = null;
        retryFromCheckpoint();
      },
    });
    modes.push(flatlineMode);
  };

  const doScan = (): void => {
    scanned = true;
    events.post({
      type: 'scanPulse',
      origin: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
    });
    events.flush();
    const d = Math.hypot(
      flight.pose.x - icePos.x,
      flight.pose.y - icePos.y,
      flight.pose.z - icePos.z,
    );
    hud.print(`SCAN  WHITE ICE  ${d.toFixed(0)} U  ${M1_ICE_ID}`);
  };

  const pushBreachMode = (): void => {
    dropOverlay();
    if (!modes.has('matrix')) pushMatrix();
    if (modes.has('breach')) return;
    modes.push(
      createBreachMode({
        breach,
        hud,
        visuals,
        camera: renderer.cameras.matrix,
        reduceMotion: () => settings.value.reduceMotion,
        onCracked() {
          visuals?.shatter(7);
          enterCore();
        },
        onFlatline(scripted) {
          startFlatline(scripted);
        },
        onBurned() {
          beginJackOut('burned');
        },
        onJackOut() {
          if (!breach.canJackOut()) return;
          beginJackOut('player');
        },
      }),
    );
  };

  const forceEngage = (): void => {
    if (!breach.engaged) breach.engage(iceAnchor());
    pushBreachMode();
  };

  const doEngage = (): boolean => {
    const ok = breach.tryEngage(player(), look(), iceAnchor());
    if (!ok) {
      hud.print('NO FACET');
      return false;
    }
    pushBreachMode();
    return true;
  };

  const doJumpChiba = (): boolean => {
    const def = getLandmark('chiba-node');
    if (!def) return false;
    const r = jump.start(def.coords);
    if (!r.ok) {
      hud.print(jumpFailMessage(r.reason));
      audio?.sfx('deckError');
      return false;
    }
    if (modes.has('deckPanel')) modes.pop();
    return true;
  };

  const openDeck = (): void => {
    if (jump.active || modes.has('deckPanel') || breach.engaged) return;
    modes.push(
      createDeckPanelMode({
        input,
        events,
        addressBook: DEFAULT_ADDRESS_BOOK,
        onJump: (coord) => {
          const r = jump.start(coord);
          if (!r.ok) return jumpFailMessage(r.reason);
          return;
        },
        onError: () => audio?.sfx('deckError'),
      }),
    );
  };

  function onMatrixInput(frame: InputFrame): void {
    if (jump.active) return;
    if (frame.pressed('scan')) doScan();
    if (frame.pressed('engage')) doEngage();
    if (frame.pressed('deck')) openDeck();
    if (frame.held('jackOut') >= JACK_OUT_HOLD && !modes.has('core')) {
      if (flight.jackOutBlocked || breach.grip.active) hud.print("DECK WON'T LET GO");
      else beginJackOut('player');
    }
  }

  const bindLandmarks = (): void => {
    for (const lm of scene.landmarks) mission.setLandmark(lm.id, lm.x, lm.y, lm.z);
  };

  const startM1 = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m1');
    if (!def) return;
    interlude?.dispose();
    interlude = null;
    ended = false;
    scanned = false;
    downloaded = false;
    mission.load(def);
    bindLandmarks();
    poseAtStart();
    mission.start(checkpoint ? { checkpoint } : undefined);
    if (checkpoint === 'chiba' || checkpoint === 'core' || checkpoint === 'take') poseAtChiba();
    if (checkpoint === 'look') mission.update(M1_LOOK_S);
    jackIn = createJackInMode({
      variant: def.start.jackInSequence,
      missionId: 'm1',
      emit: false,
      onDone() {
        jackIn = null;
        pushMatrix();
        void audio?.unlock();
        if (checkpoint === 'core' || checkpoint === 'take') enterCore();
        if (checkpoint === 'take') interior?.completeDownload();
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'start') jackIn.seek(jackIn.sequence.duration);
  };

  const showDebrief = async (): Promise<void> => {
    dropOverlay();
    interlude?.dispose();
    interlude = createInterlude({
      story: m1Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        root.dataset.knot = info.knot;
        if (info.ended) ended = true;
        if (info.ended && interlude?.ink.get('go_m2') === 1) void opts.onContinueToM2?.();
      },
    });
    interlude.ink.goto('debrief');
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
  };

  const startP0 = async (): Promise<void> => {
    const def = await loadCampaignMission('p0');
    if (!def) return;
    mission.load(def);
    bindLandmarks();
    mission.start();
    interlude = createInterlude({
      story: p0Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        root.dataset.knot = info.knot;
        root.dataset.page = info.pageId;
        if (info.ended && !chaining) {
          chaining = true;
          ended = true;
          events.post({ type: 'jackOut', reason: 'script' });
          events.flush();
          void startM1();
        }
      },
    });
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
    root.dataset.page = interlude.info.pageId;
  };

  const effects: MissionEffects = {
    say(who, line) {
      if (who === 'dixie') return;
      hud.print(line);
    },
    music(state) {
      if (
        state === 'silent' ||
        state === 'transit' ||
        state === 'approach' ||
        state === 'breach' ||
        state === 'core'
      ) {
        audio?.music.setState(state);
      }
    },
    sfx(id) {
      if ((SFX_IDS as readonly string[]).includes(id)) audio?.sfx(id as SfxId);
    },
  };

  const handle: SliceHandle = {
    get missionId() {
      return mission.def?.id ?? missionId;
    },
    get status() {
      return mission.status;
    },
    get mode() {
      return modes.top?.id ?? '';
    },
    get checkpoint() {
      return mission.checkpointId;
    },
    get phase() {
      return tutorialPhase();
    },
    get knot() {
      return interlude?.info.knot ?? null;
    },
    get ended() {
      return ended || mission.status === 'won';
    },
    get won() {
      return mission.status === 'won';
    },
    get scanned() {
      return scanned || mission.flag('scanned');
    },
    get engaged() {
      return breach.engaged;
    },
    get downloaded() {
      return downloaded || mission.flag('got-record');
    },
    get neural() {
      return breach.neural.value;
    },
    get trace() {
      return breach.trace.value;
    },
    get coords() {
      return formatMatrixCoord(
        worldToMatrixCoord(flight.pose.x, flight.pose.y, flight.pose.z, region),
      );
    },
    skipJackIn() {
      jackIn?.seek(jackIn.sequence.duration);
    },
    skipLook() {
      if (mission.time < M1_LOOK_S) mission.update(M1_LOOK_S - mission.time);
    },
    choose(n) {
      return interlude?.choose(n) ?? false;
    },
    scan: doScan,
    jumpToChiba: doJumpChiba,
    completeJump() {
      if (!jump.active) {
        if (!doJumpChiba()) return;
      }
      jump.seek(jump.duration);
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      events.flush();
      mission.update(0);
    },
    engage: doEngage,
    crack() {
      forceEngage();
      const ice = breach.ice;
      if (!ice) return;
      ice.crack();
      events.flush();
      visuals?.shatter(7);
      enterCore();
    },
    completeDownload() {
      if (!interior) enterCore();
      interior?.completeDownload();
      downloaded = true;
      events.flush();
      mission.update(0);
    },
    jackOut() {
      interior?.startJackOut();
      beginJackOut('player');
      events.flush();
      mission.update(0);
    },
    skipOverlay() {
      if (jackIn) jackIn.seek(jackIn.sequence.duration);
      else if (modes.has('jackOut') && jackOutMode) {
        jackOutMode.seek(jackOutMode.collapse.duration);
      } else if (modes.has('flatline') && flatlineMode) {
        flatlineMode.seek(FLATLINE_TIMING.total);
      }
    },
    forceFlatline() {
      breach.forceFlatline(false);
      startFlatline(false);
    },
    forceBurned() {
      breach.forceBurned();
      beginJackOut('burned');
    },
    advance(dt) {
      if (jump.active) jump.step(dt);
      else {
        const top = modes.top?.id;
        if (top === 'matrix' || top === 'core' || top === 'deckPanel') {
          flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
        }
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      interior?.updateVisuals(dt);
      if (visuals && !modes.has('core')) {
        visuals.update(dt, liveIce(), renderer.cameras.matrix, settings.value.reduceMotion);
      }
      modes.update(dt);
      events.flush();
      mission.update(dt);
      syncHudVis();
      if (!overlayPaint()) paintWorld(1);
    },
    paint() {
      syncHudVis();
      if (overlayPaint()) {
        modes.render(1);
        return;
      }
      paintWorld(1);
    },
  };

  opts.effectsSlot.current = effects;
  if (missionId === 'p0') await startP0();
  else await startM1(opts.checkpoint);

  root.dataset.mission = mission.def?.id ?? missionId;
  window.__nonspaceMission = handle;

  const slice: VerticalSlice = {
    handle,
    effects,
    update(dt) {
      if (disposed) return;
      if (jump.active) jump.step(dt);
      else {
        const top = modes.top?.id;
        if (top === 'matrix' || top === 'core' || top === 'deckPanel') {
          flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
        }
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (visuals && !modes.has('core')) {
        visuals.update(dt, liveIce(), renderer.cameras.matrix, settings.value.reduceMotion);
      }
      interior?.updateVisuals(dt);
      if (audio) {
        const f = look();
        audio.listener(player(), f, { x: 0, y: 1, z: 0 });
      }
    },
    render(alpha) {
      if (disposed) return;
      syncHudVis();
      if (overlayPaint()) return;
      paintWorld(alpha);
    },
    dispose() {
      disposed = true;
      delete window.__nonspaceMission;
      unbindAudio?.();
      interlude?.dispose();
      interior?.dispose();
      visuals?.dispose();
      prompts.dispose();
      streak.dispose();
      scene.dispose();
      hud.dispose();
      flight.collision.remove('m1-ice');
      jackIn = null;
    },
  };

  return slice;
}

export { isCampaignMissionId };
