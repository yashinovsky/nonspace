import { createWintermute, type Wintermute } from '../ai/Wintermute';
import { createNeuromancer, type Neuromancer } from '../ai/Neuromancer';
import { createBeachMode } from '../app/modes/Beach';
import { createDiveMode, type DiveMode } from '../app/modes/Dive';
import { createFlatlineMode, FLATLINE_TIMING, type FlatlineMode } from '../app/modes/Flatline';
import { createInterludeMode } from '../app/modes/Interlude';
import { createJackInMode, type JackInMode } from '../app/modes/JackIn';
import { createJackOutMode, type JackOutMode } from '../app/modes/JackOut';
import { createMatrixMode } from '../app/modes/Matrix';
import { createSimstimMode } from '../app/modes/Simstim';
import type { ModeStack } from '../app/ModeStack';
import { SFX_IDS, type AudioEngine, type SfxId } from '../audio/AudioEngine';
import { bindSfxToEvents } from '../audio/sfx/bind';
import { createBreachController, JACK_OUT_HOLD } from '../breach/BreachController';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { createIceModel, type IceModel } from '../breach/IceModel';
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { loadCampaignMission } from '../content/missions/load';
import {
  M5_CLUSTER,
  M5_HIJACK,
  M5_ICE_ID,
  M5_PAIN,
  M5_START,
  straylightIce,
} from '../content/missions/m5';
import { STRAYLIGHT_M5_GATES, straylightM5Timeline } from '../content/simstim/straylight';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createHud, type Hud } from '../hud/Hud';
import type { InputFrame, InputService } from '../input/Input';
import { createInterlude, type Interlude } from '../meat/Interlude';
import type { InkStory } from '../narrative/InkRuntime';
import type { MissionEffects, MissionRunner } from '../narrative/MissionRunner';
import { createCoordinateJump, type CoordinateJump } from '../player/CoordinateJump';
import { poseFromForward, type FlightController } from '../player/FlightController';
import type { CameraRig } from '../player/CameraRig';
import { sphereHull } from '../player/Collision';
import { createJumpStreak, sampleJumpStreak } from '../render/fx/JumpStreak';
import type { PersistencePass } from '../render/post/PersistencePass';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';
import { createSimstimRenderer } from '../render/simstim/SimstimRenderer';
import type { SimstimFeed } from '../simstim/SimstimFeed';
import { formatMatrixCoord, matrixCoordToWorld, worldToMatrixCoord } from '../world/coords';
import { createDiveTube, type DiveTube } from '../world/DiveTube';
import {
  createDiveState,
  DIVE_LANES_DEFAULT,
  DIVE_SEGMENTS,
  DIVE_SPEED,
  DIVE_TUBE_RADIUS,
  KUANG_GATE_TOL,
  type DiveState,
} from '../world/diveMath';
import { createKuang, KUANG_MIMIC_S, type Kuang } from '../world/Kuang';
import { createKuangScene } from './kuangScene';
import m5Ink from '../content/ink/m5.json';

export type KuangGradePhase =
  'brief' | 'jackIn' | 'ascent' | 'deploy' | 'dive' | 'straylight' | 'intercept' | 'beach';

export interface KuangGradeHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: KuangGradePhase;
  knot: string | null;
  ended: boolean;
  won: boolean;
  mimic: number;
  reveal: number;
  lane: number;
  lanes: number;
  segment: number;
  gatesCleared: number;
  divePhase: string;
  flipped: boolean;
  pain: number;
  hijackText: string;
  jane: boolean;
  jackOutBlocked: boolean;
  soften: number;
  beach: boolean;
  handoff: string;
  mollyGates: string;
  meatTime: number;
  skipBrief(): void;
  skipJackIn(): void;
  choose(n: number): boolean;
  completeAscent(): void;
  deployKuang(): void;
  enterDive(): void;
  enterGate(): void;
  crackGate(): void;
  playMollyGate(index: number): void;
  flip(on?: boolean): void;
  seekMeat(t: number): void;
  intercept(): void;
  tryJackOut(): string;
  skipOverlay(): void;
  forceFlatline(scripted?: boolean): void;
  advance(dt: number): void;
  paint(): void;
}

export interface KuangGradeMission {
  readonly handle: KuangGradeHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface KuangGradeMissionOptions {
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
  simstim: SimstimFeed;
  checkpoint?: string;
  effectsSlot: { current: MissionEffects | null };
}

const FWD = { x: 0, y: 0, z: -1 };
const LOOK = { yaw: 0, pitch: 0 };

const MOLLY = [
  { iceNode: 'straylight-hall', tMeat: 3.2, pain: 0, hijack: false },
  { iceNode: 'straylight-stair', tMeat: 8.5, pain: M5_PAIN, hijack: true },
  { iceNode: 'straylight-gallery', tMeat: 15.5, pain: 0, hijack: false },
] as const;

function clusterWorld(): { x: number; y: number; z: number } {
  const def = getLandmark(M5_CLUSTER);
  return def ? landmarkWorldPos(def.coords) : matrixCoordToWorld({ ...M5_START, y: 5600, z: 40 });
}

function startWorld(): { x: number; y: number; z: number } {
  return matrixCoordToWorld(M5_START);
}

export async function startKuangGradeMission(
  opts: KuangGradeMissionOptions,
): Promise<KuangGradeMission> {
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
    simstim,
  } = opts;

  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0.5;
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

  const scene = createKuangScene(renderer, flight.collision);
  scene.setVisible(false);

  const icePos = clusterWorld();
  const iceDef = straylightIce();
  flight.collision.add(sphereHull('m5-ice', 'ice', icePos.x, icePos.y, icePos.z, 22));

  const displayIce: IceModel = createIceModel(iceDef, { seed: 11 });
  const visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const breach = createBreachController({ events, save, audio: audio ?? undefined });
  breach.neural.reset(10);
  breach.neural.setScars(0);
  breach.trace.reset(4);
  breach.markCheckpoint();

  const view = createSimstimRenderer(renderer);
  const timeline = straylightM5Timeline();
  simstim.load(timeline, STRAYLIGHT_M5_GATES);
  view.load(timeline);
  const simstimMode = createSimstimMode(simstim, view);

  const kuang: Kuang = createKuang({ renderer, pose: 'deploy', mimic: 0, reveal: 0 });
  kuang.object.visible = false;
  kuang.object.position.set(icePos.x, icePos.y + 6, icePos.z + 18);

  let diveState: DiveState = createDiveState({ lanes: DIVE_LANES_DEFAULT, seed: 11 });
  let tube: DiveTube | null = null;
  let dive: DiveMode | null = null;

  const wm: Wintermute = createWintermute({
    palette: renderer.palette,
    renderer,
    save,
    hud,
  });

  let jackIn: JackInMode | null = null;
  let jackOutMode: JackOutMode | null = null;
  let flatlineMode: FlatlineMode | null = null;
  let interlude: Interlude | null = null;
  let region = 'ORBT';
  let ended = false;
  let disposed = false;
  let beachOn = false;
  let handoff = '';
  let intercepting = false;
  let mollyIndex = 0;
  let nm: Neuromancer | null = null;

  const streak = createJumpStreak({ palette: renderer.palette, scene: renderer.scenes.matrix });

  const jump: CoordinateJump = createCoordinateJump({
    flight,
    gripped: () => breach.grip.active,
    inCore: () => false,
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

  const restoreMatrixCam = (): void => {
    const cam = renderer.cameras.matrix;
    cam.near = 0.5;
    cam.far = 80_000;
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
  };

  const phaseOf = (): KuangGradePhase => {
    if (beachOn || modes.has('beach')) return 'beach';
    if (modes.has('interlude')) return interlude?.info.knot === 'debrief' ? 'beach' : 'brief';
    if (modes.has('jackIn')) return 'jackIn';
    if (modes.has('flatline') || intercepting) return 'intercept';
    if (simstim.flipped || modes.has('simstim')) return 'straylight';
    if (modes.has('dive')) return 'dive';
    if (mission.flag('kuang-out') || kuang.reveal > 0.5) return 'deploy';
    return 'ascent';
  };

  const paintHud = (): void => {
    const p = player();
    const coord = worldToMatrixCoord(p.x, p.y, p.z, region);
    hud.setCoords(formatMatrixCoord(coord));
    hud.setSpeed(modes.has('dive') ? diveState.speed : flight.telemetry.speed);
    hud.setNeural(breach.neural.value);
    hud.setTrace(breach.trace.value);
    hud.setScars(breach.neural.scars);
    hud.setFlatline(modes.has('flatline'));
    hud.setPipLink(simstim.linkLive && !simstim.flipped);
    hud.setGrip(null);
    if (modes.has('dive') && diveState.phase === 'gate') hud.setMode('BREACH');
    else if (modes.has('dive')) hud.setMode('DIVE');
    else if (simstim.flipped) hud.setMode('SIMSTIM');
    else if (jump.active) hud.setMode('JUMP');
    else if (kuang.object.visible) hud.setMode('KUANG');
    else hud.setMode('TRANSIT');
    const blips = scene.landmarks.map((lm) => {
      const dx = lm.x - p.x;
      const dz = lm.z - p.z;
      const dist = Math.hypot(dx, dz);
      return { angle: Math.atan2(dz, dx), radius: Math.min(1, dist / 8000), kind: 'ice' as const };
    });
    hud.setBlips(blips);
    hud.update(0);
  };

  const applyFx = (): void => {
    const sample = sampleJumpStreak(jump.phase, jump.streakU, settings.value.reduceMotion);
    if (persist && 'decayScale' in persist) persist.decayScale = sample.decayScale;
    streak.update(flight.pose, icePos, sample, {
      w: renderer.internalWidth,
      h: renderer.internalHeight,
    });
  };

  const overlayPaint = (): boolean => {
    const id = modes.top?.id;
    return (
      id === 'interlude' ||
      id === 'jackIn' ||
      id === 'jackOut' ||
      id === 'flatline' ||
      id === 'simstim' ||
      id === 'beach'
    );
  };

  const syncHudVis = (): void => {
    const id = modes.top?.id;
    renderer.scenes.hud.visible =
      id !== 'interlude' && id !== 'jackIn' && id !== 'jackOut' && id !== 'beach';
  };

  const paintWorld = (alpha = 1): void => {
    if (modes.has('dive')) {
      dive?.paint();
      kuang.paint();
      paintHud();
      return;
    }
    cameraRig.apply(flight, alpha);
    const cam = renderer.cameras.matrix.position;
    scene.follow(cam, renderer.quality.latticeRadius);
    scene.paint();
    if (visuals && visuals.object.visible) {
      visuals.update(0, displayIce, renderer.cameras.matrix, settings.value.reduceMotion);
    }
    if (kuang.object.visible) kuang.paint();
    applyFx();
    paintHud();
    if (simstim.flipped) {
      const sample = simstim.sample();
      view.apply(sample, simstim.overlay, simstim.meatTime);
    }
  };

  const dropOverlay = (): void => {
    while (
      modes.top &&
      (modes.top.id === 'deckPanel' ||
        modes.top.id === 'breach' ||
        modes.top.id === 'core' ||
        modes.top.id === 'dive' ||
        modes.top.id === 'simstim' ||
        modes.top.id === 'flatline' ||
        modes.top.id === 'jackOut' ||
        modes.top.id === 'jackIn' ||
        modes.top.id === 'interlude' ||
        modes.top.id === 'boot' ||
        modes.top.id === 'beach')
    ) {
      modes.pop();
    }
  };

  function onMatrixInput(frame: InputFrame): void {
    if (jump.active) return;
    if (frame.pressed('simstim')) doFlip(true);
    if (frame.pressed('scan')) {
      events.post({
        type: 'scanPulse',
        origin: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
      });
      events.flush();
      hud.print(`SCAN  ${M5_ICE_ID}`);
    }
    if (frame.pressed('engage') && mission.flag('at-cluster') && !mission.flag('kuang-out')) {
      doDeploy();
    }
    if (frame.pressed('engage') && mission.flag('kuang-out') && !modes.has('dive')) {
      doEnterDive();
    }
    if (frame.held('jackOut') >= JACK_OUT_HOLD) {
      if (flight.jackOutBlocked || breach.grip.active || intercepting) {
        hud.print("DECK WON'T LET GO");
      } else {
        beginJackOut('player');
      }
    }
  }

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
  };

  const poseAtStart = (): void => {
    const from = startWorld();
    poseFromForward(icePos.x - from.x, icePos.y - from.y, icePos.z - from.z, LOOK);
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
    region = 'ORBT';
  };

  const poseAtCluster = (): void => {
    const from = {
      x: icePos.x + 380,
      y: icePos.y + 90,
      z: icePos.z + 460,
    };
    poseFromForward(icePos.x - from.x, icePos.y - from.y, icePos.z - from.z, LOOK);
    flight.setPose({
      x: from.x,
      y: from.y,
      z: from.z,
      yaw: LOOK.yaw,
      pitch: LOOK.pitch,
      vx: 0,
      vy: 0,
      vz: 0,
      fov: flight.params.fovBase,
    });
    region = 'ORBT';
    mission.setPlayerPosition(from.x, from.y, from.z);
  };

  const doFlip = (on: boolean): void => {
    if (on === simstim.flipped && on === modes.has('simstim')) return;
    mission.meatTimeRunning = on;
    simstim.setFlipped(on);
    if (on) {
      if (!modes.has('simstim')) modes.push(simstimMode);
    } else if (modes.has('simstim')) {
      modes.pop();
    }
  };

  const doDeploy = (): void => {
    kuang.object.visible = true;
    kuang.pose = 'deploy';
    kuang.reveal = 1;
    kuang.mimic = 1;
    kuang.object.position.set(icePos.x, icePos.y + 6, icePos.z + 18);
    kuang.paint();
    events.post({ type: 'softUsed', softId: 'kuang' });
    events.flush();
    mission.update(0);
    hud.print('KUANG GRADE MARK ELEVEN');
    audio?.sfx('kuang');
  };

  const leaveDive = (): void => {
    if (modes.has('dive')) {
      while (modes.top?.id === 'dive') modes.pop();
    }
    dive = null;
    tube?.dispose();
    tube = null;
    kuang.pose = 'deploy';
    kuang.object.position.set(icePos.x, icePos.y + 6, icePos.z + 18);
    restoreMatrixCam();
    scene.setVisible(true);
    if (visuals) visuals.object.visible = true;
  };

  const doEnterDive = (): void => {
    if (!mission.flag('kuang-out')) doDeploy();
    scene.setVisible(false);
    if (visuals) visuals.object.visible = false;
    kuang.object.position.set(0, 0, 0);
    kuang.pose = 'coil';
    kuang.reveal = 1;
    kuang.mimic = Math.max(kuang.mimic, 0.4);
    diveState = createDiveState({ lanes: DIVE_LANES_DEFAULT, seed: 11, speed: DIVE_SPEED });
    tube?.dispose();
    tube = createDiveTube(renderer, diveState.lanes, DIVE_TUBE_RADIUS);
    dive = createDiveMode({
      state: diveState,
      tube,
      kuang,
      hud,
      audio: audio ?? undefined,
      camera: renderer.cameras.matrix,
      reduceMotion: () => settings.value.reduceMotion,
      onGateClear() {
        /* Molly interleave is scripted via playMollyGate / live flip. */
      },
      onDone() {
        leaveDive();
        pushMatrix();
      },
    });
    dropOverlay();
    if (!modes.has('matrix')) pushMatrix();
    if (!modes.has('dive')) modes.push(dive);
    events.flush();
    mission.update(0);
  };

  const playMolly = (index: number): void => {
    const beat = MOLLY[index];
    if (!beat) return;
    mollyIndex = Math.max(mollyIndex, index + 1);
    doFlip(true);
    const step = 0.25;
    let guard = 0;
    mission.meatTimeRunning = true;
    while (mission.meatTime < beat.tMeat && guard++ < 4000) {
      const dt = Math.min(step, beat.tMeat - mission.meatTime);
      mission.update(dt);
      simstim.update(0);
    }
    simstim.crack(beat.iceNode);
    events.flush();
    mission.update(0);
    simstim.update(0);
    let catchup = 0;
    while (simstim.debug.playbackTime + 0.05 < beat.tMeat && catchup++ < 40) {
      mission.update(0.25);
      simstim.update(0.25);
    }
    if (beat.pain > 0) simstim.pain.hurt(beat.pain);
    if (beat.hijack) {
      wm.apply({ kind: 'hijack', text: M5_HIJACK });
      hud.hijack(M5_HIJACK);
    }
    const sample = simstim.sample();
    view.apply(sample, simstim.overlay, simstim.meatTime);
  };

  const handoffBeach = (): void => {
    if (beachOn) return;
    beachOn = true;
    handoff = 'm6';
    leaveDive();
    dropOverlay();
    scene.setVisible(false);
    kuang.object.visible = false;
    if (visuals) visuals.object.visible = false;
    nm?.apply({ kind: 'beach' });
    if (!modes.has('beach')) modes.reset(createBeachMode());
    renderer.postMode = 'beach';
    root.dataset.handoff = 'm6';
    root.dataset.mission = 'm6';
    ended = true;
  };

  nm = createNeuromancer({
    palette: renderer.palette,
    flight,
    forceBeach: handoffBeach,
  });

  const beginIntercept = (): void => {
    if (intercepting) return;
    intercepting = true;
    doFlip(false);
    leaveDive();
    pushMatrix();
    kuang.object.visible = true;
    nm?.apply({ kind: 'soften', amount: 0.85 });
    nm?.apply({ kind: 'pull', target: icePos, strength: 1 });
    hud.print("DECK WON'T LET GO");
    breach.forceFlatline(true);
    events.flush();
    mission.update(0);
    dropOverlay();
    flatlineMode = createFlatlineMode({
      breach,
      scripted: true,
      onDone() {
        flatlineMode = null;
        handoffBeach();
      },
    });
    modes.push(flatlineMode);
  };

  const beginJackOut = (reason: 'player' | 'burned' | 'script'): void => {
    if (flight.jackOutBlocked || intercepting) {
      hud.print("DECK WON'T LET GO");
      return;
    }
    dropOverlay();
    jackOutMode = createJackOutMode({
      reason,
      onDone() {
        jackOutMode = null;
        pushMatrix();
      },
    });
    modes.push(jackOutMode);
  };

  const bindLandmarks = (): void => {
    for (const lm of scene.landmarks) mission.setLandmark(lm.id, lm.x, lm.y, lm.z);
  };

  const beginJackIn = (checkpoint?: string): void => {
    interlude?.dispose();
    interlude = null;
    jackIn = createJackInMode({
      variant: 'short',
      missionId: 'm5',
      emit: true,
      onDone() {
        jackIn = null;
        pushMatrix();
        void audio?.unlock();
        if (checkpoint && checkpoint !== 'ascent') poseAtCluster();
        if (checkpoint === 'deploy' || checkpoint === 'dive' || checkpoint === 'straylight') {
          doDeploy();
        }
        if (checkpoint === 'dive' || checkpoint === 'straylight') doEnterDive();
        if (checkpoint === 'intercept') beginIntercept();
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'ascent') jackIn.seek(jackIn.sequence.duration);
  };

  const showBriefThenJack = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m5');
    if (!def) return;
    interlude?.dispose();
    interlude = null;
    ended = false;
    mission.load(def);
    bindLandmarks();
    poseAtStart();
    simstim.attachMission(mission);
    opts.effectsSlot.current = effects;
    mission.meatTimeRunning = false;
    mission.start(checkpoint ? { checkpoint } : undefined);
    if (checkpoint && checkpoint !== 'ascent') poseAtCluster();

    if (!checkpoint || checkpoint === 'ascent') {
      interlude = createInterlude({
        story: m5Ink as InkStory,
        audio: audio ?? undefined,
        onChange(info) {
          root.dataset.knot = info.knot;
          if (info.ended && !jackIn) beginJackIn(checkpoint);
        },
      });
      interlude.ink.goto('brief');
      modes.reset(createInterludeMode(interlude));
      root.dataset.knot = interlude.info.knot;
      return;
    }
    beginJackIn(checkpoint);
  };

  const pickJackIn = (): boolean => {
    if (!interlude) return false;
    const jack = interlude.ink.state.choices.find((c) => /JACK IN/i.test(c.text));
    if (jack) return interlude.choose(jack.index);
    return false;
  };

  const effects: MissionEffects = {
    say(_who, line) {
      hud.print(line);
    },
    music(state) {
      if (
        state === 'silent' ||
        state === 'transit' ||
        state === 'approach' ||
        state === 'breach' ||
        state === 'core' ||
        state === 'kuangDive' ||
        state === 'simstim' ||
        state === 'beach'
      ) {
        audio?.music.setState(state);
      }
    },
    sfx(id) {
      if ((SFX_IDS as readonly string[]).includes(id)) audio?.sfx(id as SfxId);
    },
    wintermute(action) {
      wm.apply(action);
    },
    neuromancer(action) {
      nm?.apply(action);
    },
    forceMode(id) {
      if (id === 'beach') handoffBeach();
    },
  };

  const janeVisible = (): boolean => {
    const fig = simstim.sample().figures.find((f) => f.id === 'jane');
    return !!fig && fig.pose !== 'hidden';
  };

  const handle: KuangGradeHandle = {
    get missionId() {
      return mission.def?.id ?? 'm5';
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
      return phaseOf();
    },
    get knot() {
      return interlude?.info.knot ?? null;
    },
    get ended() {
      return ended || mission.status === 'won' || beachOn;
    },
    get won() {
      return mission.status === 'won' || beachOn;
    },
    get mimic() {
      return kuang.mimic;
    },
    get reveal() {
      return kuang.reveal;
    },
    get lane() {
      return diveState.lane;
    },
    get lanes() {
      return diveState.lanes;
    },
    get segment() {
      return diveState.segment;
    },
    get gatesCleared() {
      return diveState.gatesCleared;
    },
    get divePhase() {
      return dive?.state.phase ?? diveState.phase;
    },
    get flipped() {
      return simstim.flipped;
    },
    get pain() {
      return simstim.pain.amount;
    },
    get hijackText() {
      return hud.hijackText || wm.hijackText;
    },
    get jane() {
      return janeVisible();
    },
    get jackOutBlocked() {
      return flight.jackOutBlocked || intercepting;
    },
    get soften() {
      return nm?.soften ?? 0;
    },
    get beach() {
      return beachOn || modes.has('beach');
    },
    get handoff() {
      return handoff;
    },
    get mollyGates() {
      return simstim.gates.snapshots.map((s) => s.state).join(',');
    },
    get meatTime() {
      return simstim.meatTime;
    },
    skipBrief() {
      if (!interlude || !modes.has('interlude')) return;
      let guard = 4;
      while (interlude && modes.has('interlude') && guard-- > 0) {
        if (pickJackIn()) break;
        if (!interlude.choose(1)) break;
      }
    },
    skipJackIn() {
      if (interlude && modes.has('interlude') && !pickJackIn()) interlude.choose(1);
      jackIn?.seek(jackIn.sequence.duration);
    },
    choose(n) {
      return interlude?.choose(n) ?? false;
    },
    completeAscent() {
      if (jump.active) jump.seek(jump.duration);
      else {
        const r = jump.start(getLandmark(M5_CLUSTER)!.coords);
        if (r.ok) jump.seek(jump.duration);
        else poseAtCluster();
      }
      poseAtCluster();
      events.flush();
      mission.update(0);
    },
    deployKuang() {
      if (!mission.flag('at-cluster')) poseAtCluster();
      doDeploy();
    },
    enterDive: doEnterDive,
    enterGate() {
      if (!dive) doEnterDive();
      dive?.enterGate();
    },
    crackGate() {
      if (!dive) doEnterDive();
      if (dive && dive.state.phase !== 'gate') dive.enterGate();
      dive?.forceCrack();
      events.flush();
      mission.update(0);
    },
    playMollyGate(index) {
      playMolly(index);
    },
    flip(on = true) {
      doFlip(on);
    },
    seekMeat(t) {
      mission.meatTimeRunning = true;
      const step = 0.25;
      let guard = 0;
      while (mission.meatTime < t && guard++ < 4000) {
        handle.advance(Math.min(step, t - mission.meatTime));
      }
    },
    intercept: beginIntercept,
    tryJackOut() {
      if (flight.jackOutBlocked || intercepting) {
        hud.print("DECK WON'T LET GO");
        return "DECK WON'T LET GO";
      }
      beginJackOut('player');
      return 'jackOut';
    },
    skipOverlay() {
      if (interlude && modes.has('interlude')) {
        if (!pickJackIn()) interlude.choose(1);
      } else if (jackIn) jackIn.seek(jackIn.sequence.duration);
      else if (modes.has('jackOut') && jackOutMode) {
        jackOutMode.seek(jackOutMode.collapse.duration);
      } else if (modes.has('flatline') && flatlineMode) {
        flatlineMode.seek(FLATLINE_TIMING.total);
      }
    },
    forceFlatline(scripted = true) {
      beginIntercept();
      if (!scripted) breach.forceFlatline(false);
    },
    advance(dt) {
      if (jump.active) jump.step(dt);
      else {
        const top = modes.top?.id;
        if (top === 'matrix' || top === 'deckPanel') {
          flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
        }
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (kuang.object.visible) kuang.update(dt, settings.value.reduceMotion);
      nm?.update(dt);
      wm.update(dt);
      scene.core.updateVisuals(dt);
      modes.update(dt);
      events.flush();
      mission.update(dt);
      simstim.update(0);
      syncHudVis();
      if (!overlayPaint()) paintWorld(1);
      root.dataset.phase = phaseOf();
    },
    paint() {
      syncHudVis();
      if (overlayPaint()) {
        interlude?.update(0);
        if (simstim.flipped) {
          const sample = simstim.sample();
          view.apply(sample, simstim.overlay, simstim.meatTime);
        }
        modes.render(1);
        hud.update(0);
        return;
      }
      paintWorld(1);
    },
  };

  opts.effectsSlot.current = effects;
  await showBriefThenJack(opts.checkpoint);

  root.dataset.mission = 'm5';
  (window as unknown as { __nonspaceMission?: KuangGradeHandle }).__nonspaceMission = handle;

  const run: KuangGradeMission = {
    handle,
    effects,
    update(dt) {
      if (disposed) return;
      if (jump.active) jump.step(dt);
      else {
        const top = modes.top?.id;
        if (top === 'matrix' || top === 'deckPanel') {
          flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
        }
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (kuang.object.visible) kuang.update(dt, settings.value.reduceMotion);
      nm?.update(dt);
      wm.update(dt);
      scene.core.updateVisuals(dt);
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
      const w = window as unknown as { __nonspaceMission?: KuangGradeHandle };
      if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      unbindAudio?.();
      interlude?.dispose();
      visuals?.dispose();
      tube?.dispose();
      kuang.dispose();
      streak.dispose();
      scene.dispose();
      hud.dispose();
      wm.dispose();
      nm?.dispose();
      flight.collision.remove('m5-ice');
      jackIn = null;
    },
  };

  return run;
}

export { KUANG_GATE_TOL, KUANG_MIMIC_S, DIVE_SEGMENTS };
