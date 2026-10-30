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
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { loadCampaignMission } from '../content/missions/load';
import { M4_DROP, M4_ICE_ID, M4_RECORD, M4_START, turingIce } from '../content/missions/m4';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { Difficulty, SettingsStore } from '../core/settings';
import { createSoftsRuntime, type SoftsRuntime, type SoftsWorld } from '../deck/softs/registry';
import type { WatcherLureSink } from '../deck/softs/effects';
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
import { formatMatrixCoord, matrixCoordToWorld, worldToMatrixCoord } from '../world/coords';
import { createWatcherField, type WatcherField } from '../world/watchers/Watcher';
import {
  placeTuringWatchers,
  stealthPath,
  turingFieldSpec,
  turingStartFromDrop,
} from './turingField';
import { createTuringScene } from './turingScene';
import m4Ink from '../content/ink/m4.json';

export type TuringPhase = 'brief' | 'jackIn' | 'stealth' | 'breach' | 'core' | 'out' | 'debrief';

export interface TuringHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: TuringPhase;
  knot: string | null;
  pageTitle: string;
  ringing: boolean;
  ended: boolean;
  won: boolean;
  heat: number;
  watcherCount: number;
  exposed: boolean;
  decoyRemaining: number;
  breaches: number;
  engaged: boolean;
  wiped: boolean;
  skipIce: boolean;
  skipBrief(): void;
  skipJackIn(): void;
  choose(n: number): boolean;
  dropDecoy(): boolean;
  jumpToDrop(): boolean;
  completeJump(): void;
  flyCorridor(): void;
  engage(): boolean;
  crack(): void;
  completeWipe(): void;
  leaveCore(): void;
  jackOut(): void;
  skipOverlay(): void;
  advance(dt: number): void;
  paint(): void;
}

export interface TuringMission {
  readonly handle: TuringHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface TuringMissionOptions {
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
  checkpoint?: string;
  effectsSlot: { current: MissionEffects | null };
}

const FWD = { x: 0, y: 0, z: -1 };
const LOOK = { yaw: 0, pitch: 0 };

function dropWorld(): { x: number; y: number; z: number } {
  const def = getLandmark(M4_DROP);
  return def ? landmarkWorldPos(def.coords) : matrixCoordToWorld({ ...M4_START, z: 72 });
}

function startWorld(): { x: number; y: number; z: number } {
  return matrixCoordToWorld(M4_START);
}

export async function startTuringMission(opts: TuringMissionOptions): Promise<TuringMission> {
  const { root, renderer, events, save, settings, input, flight, cameraRig, modes, mission } = opts;

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

  const scene = createTuringScene(renderer, flight.collision);
  scene.setVisible(false);

  const icePos = dropWorld();
  const difficulty: Difficulty = settings.value.difficulty;
  const heat0 = save.data.campaign.heat ?? 0;
  const fieldSpec = turingFieldSpec(heat0, difficulty);
  const iceDef = turingIce(heat0, difficulty);

  flight.collision.add(sphereHull('m4-ice', 'ice', icePos.x, icePos.y, icePos.z, 12));

  const iceAnchor = (): IceAnchor => ({
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: 13,
  });

  const displayIce: IceModel = createIceModel(iceDef, { seed: 13 });
  const visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const breach = createBreachController({ events, save, audio: audio ?? undefined });
  breach.neural.reset(8);
  breach.neural.setScars(0);
  breach.trace.reset(2);
  breach.markCheckpoint();

  const softs: SoftsRuntime = createSoftsRuntime();
  softs.beginRun({
    act: 3,
    slots: ['decoy', 'probe', 'clamp', 'damper'],
  });

  const watchers = placeTuringWatchers(heat0, difficulty, icePos);
  const field: WatcherField = createWatcherField({
    watchers,
    palette: renderer.palette,
    scene: renderer.scenes.matrix,
    events,
    trace: breach.trace,
    player: turingStartFromDrop(icePos, fieldSpec),
    heading: 0,
    drawProbe: false,
  });
  field.object.visible = false;

  const lureSink: WatcherLureSink = {
    setLure(next) {
      field.clearLures();
      if (next && next.remaining > 0) {
        field.dropLure({ x: next.x, y: next.y, z: next.z }, next.remaining, next.traceMul);
      }
    },
  };

  let interior: CoreInterior | null = null;
  let jackIn: JackInMode | null = null;
  let jackOutMode: JackOutMode | null = null;
  let flatlineMode: FlatlineMode | null = null;
  let interlude: Interlude | null = null;
  let region = 'EURO';
  let wiped = false;
  let ended = false;
  let disposed = false;
  let breaches = 0;
  let dropPose: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

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

  const softWorld = (): SoftsWorld => ({
    ice: breach.ice ?? displayIce,
    knobs: breach.knobs,
    events,
    player: player(),
    lure: lureSink,
  });

  const phaseOf = (): TuringPhase => {
    if (modes.has('interlude')) return interlude?.info.knot === 'debrief' ? 'debrief' : 'brief';
    if (modes.has('jackIn')) return 'jackIn';
    if (modes.has('jackOut')) return 'out';
    if (modes.has('core')) return 'core';
    if (breach.engaged) return 'breach';
    return 'stealth';
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
    hud.setSofts(softs.hudSlots);
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
    } else if (field.exposed) {
      hud.setMode('SWEEP');
      hud.setGrip(null);
      hud.setLock(null);
    } else if (field.lureRemaining > 0) {
      hud.setMode('DECOY');
      hud.setGrip(null);
      hud.setLock(null);
    } else {
      hud.setMode('TRANSIT');
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
        radius: Math.min(1, dist / 8000),
        kind: 'ice' as const,
      };
    });
    hud.setBlips([...field.blips, ...blips]);
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
    interior?.paint();
    field.draw();
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

  function onMatrixInput(frame: InputFrame): void {
    if (jump.active) return;
    if (frame.pressed('scan')) {
      events.post({
        type: 'scanPulse',
        origin: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
      });
      events.flush();
      hud.print(`SCAN  ${M4_ICE_ID}`);
    }
    if (frame.pressed('engage')) doEngage();
    if (frame.pressed('deck')) openDeck();
    if (frame.held('jackOut') >= JACK_OUT_HOLD && !modes.has('core')) {
      if (flight.jackOutBlocked || breach.grip.active) hud.print("DECK WON'T LET GO");
      else beginJackOut('player');
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
    field.object.visible = true;
    if (visuals) visuals.object.visible = !interior;
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
    region = 'EURO';
    field.setPlayer(from.x, from.y, from.z, LOOK.yaw);
  };

  const poseAtDrop = (): void => {
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
    region = 'EURO';
    mission.setPlayerPosition(arr.x, arr.y, arr.z);
    field.setPlayer(arr.x, arr.y, arr.z, arr.yaw);
  };

  const enterCore = (): void => {
    if (interior) return;
    visuals?.shatter(7);
    if (visuals) visuals.object.visible = false;
    scene.setVisible(false);
    field.object.visible = false;
    interior = createCoreInterior({
      events,
      trace: breach.trace,
      heat: breach.heat,
      def: { seed: 13, strata: 7, targetRecord: M4_RECORD, layers: 1, downloadHold: 3 },
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
          wiped = true;
        },
        onJackOut() {
          leaveCore();
        },
        onBurned() {
          beginJackOut('burned');
        },
      }),
    );
    hud.print('WIPE RECORD');
  };

  const leaveCore = (): void => {
    dropOverlay();
    interior?.dispose();
    interior = null;
    renderer.cameras.matrix.far = 80_000;
    renderer.cameras.matrix.updateProjectionMatrix();
    if (dropPose) {
      flight.setPose({
        ...dropPose,
        vx: 0,
        vy: 0,
        vz: 0,
        fov: flight.params.fovBase,
      });
      mission.setPlayerPosition(dropPose.x, dropPose.y, dropPose.z);
      field.setPlayer(dropPose.x, dropPose.y, dropPose.z, dropPose.yaw);
    } else {
      poseAtDrop();
    }
    region = 'EURO';
    scene.setVisible(true);
    field.object.visible = true;
    pushMatrix();
  };

  const showDebrief = (): void => {
    dropOverlay();
    scene.setVisible(false);
    field.object.visible = false;
    interlude?.dispose();
    interlude = createInterlude({
      story: m4Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        root.dataset.knot = info.knot;
        if (info.ended) ended = true;
      },
    });
    interlude.ink.goto('debrief');
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
  };

  const beginJackOut = (reason: 'player' | 'burned' | 'script'): void => {
    dropOverlay();
    jackOutMode = createJackOutMode({
      reason,
      onDone() {
        jackOutMode = null;
        if (reason === 'burned') {
          poseAtStart();
          pushMatrix();
          return;
        }
        showDebrief();
      },
    });
    modes.push(jackOutMode);
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
          breaches += 1;
          visuals?.shatter(7);
          enterCore();
        },
        onFlatline(scripted) {
          dropOverlay();
          flatlineMode = createFlatlineMode({
            breach,
            scripted: !!scripted,
            onDone() {
              flatlineMode = null;
              poseAtDrop();
              pushMatrix();
            },
          });
          modes.push(flatlineMode);
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

  const doJump = (id: string): boolean => {
    const def = getLandmark(id);
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

  const bindLandmarks = (): void => {
    for (const lm of scene.landmarks) mission.setLandmark(lm.id, lm.x, lm.y, lm.z);
  };

  const beginJackIn = (checkpoint?: string): void => {
    interlude?.dispose();
    interlude = null;
    jackIn = createJackInMode({
      variant: 'short',
      missionId: 'm4',
      emit: false,
      onDone() {
        jackIn = null;
        pushMatrix();
        void audio?.unlock();
        if (checkpoint === 'wipe' || checkpoint === 'drop') {
          poseAtDrop();
          if (checkpoint === 'wipe') enterCore();
        }
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'start') jackIn.seek(jackIn.sequence.duration);
  };

  const showBriefThenJack = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m4');
    if (!def) return;
    interlude?.dispose();
    interlude = null;
    ended = false;
    mission.load(def);
    bindLandmarks();
    poseAtStart();
    opts.effectsSlot.current = effects;
    mission.start(checkpoint ? { checkpoint } : undefined);
    if (checkpoint === 'drop' || checkpoint === 'wipe') poseAtDrop();

    if (!checkpoint || checkpoint === 'start') {
      interlude = createInterlude({
        story: m4Ink as InkStory,
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
        state === 'core'
      ) {
        audio?.music.setState(state);
      }
    },
    sfx(id) {
      if ((SFX_IDS as readonly string[]).includes(id)) audio?.sfx(id as SfxId);
    },
  };

  const syncWatchers = (dt: number): void => {
    const p = player();
    field.setPlayer(p.x, p.y, p.z, flight.pose.yaw);
    if (dt > 0 && !modes.has('core') && !overlayPaint()) field.step(dt);
    else field.draw();
  };

  const handle: TuringHandle = {
    get missionId() {
      return mission.def?.id ?? 'm4';
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
    get pageTitle() {
      return interlude?.ink.tag('title') ?? '';
    },
    get ringing() {
      return interlude?.info.ringing ?? false;
    },
    get ended() {
      return ended || mission.status === 'won';
    },
    get won() {
      return mission.status === 'won';
    },
    get heat() {
      return heat0;
    },
    get watcherCount() {
      return field.states.length;
    },
    get exposed() {
      return field.exposed;
    },
    get decoyRemaining() {
      return field.lureRemaining;
    },
    get breaches() {
      return breaches;
    },
    get engaged() {
      return breach.engaged;
    },
    get wiped() {
      return wiped || mission.flag('wiped');
    },
    get skipIce() {
      return fieldSpec.skipIce;
    },
    skipBrief() {
      if (!interlude || !modes.has('interlude')) return;
      let guard = 6;
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
    dropDecoy() {
      return softs.use('decoy', softWorld()).ok;
    },
    jumpToDrop() {
      return doJump(M4_DROP);
    },
    completeJump() {
      jump.seek(jump.duration);
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      region = 'EURO';
      dropPose = {
        x: flight.pose.x,
        y: flight.pose.y,
        z: flight.pose.z,
        yaw: flight.pose.yaw,
        pitch: flight.pose.pitch,
      };
      field.setPlayer(flight.pose.x, flight.pose.y, flight.pose.z, flight.pose.yaw);
      events.flush();
      mission.update(0);
    },
    flyCorridor() {
      softs.use('decoy', softWorld());
      const path = stealthPath(heat0, difficulty, icePos);
      for (const p of path) {
        flight.setPose({
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: 0,
          pitch: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          fov: flight.params.fovBase,
        });
        field.setPlayer(p.x, p.y, p.z, 0);
        field.step(0.05);
        mission.setPlayerPosition(p.x, p.y, p.z);
        events.flush();
        mission.update(0.05);
      }
      dropPose = {
        x: flight.pose.x,
        y: flight.pose.y,
        z: flight.pose.z,
        yaw: flight.pose.yaw,
        pitch: flight.pose.pitch,
      };
    },
    engage: doEngage,
    crack() {
      forceEngage();
      const ice = breach.ice;
      if (!ice) return;
      let guard = 4;
      while (ice.state.status === 'engaged' && guard-- > 0) ice.crack();
      breaches = Math.max(breaches, 1);
      events.flush();
      visuals?.shatter(7);
      enterCore();
    },
    completeWipe() {
      if (fieldSpec.skipIce && !interior) enterCore();
      if (!interior) enterCore();
      interior?.completeDownload();
      wiped = true;
      events.flush();
      mission.update(0);
    },
    leaveCore,
    jackOut() {
      beginJackOut('player');
      events.flush();
      mission.update(0);
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
      softs.handleInput((a) => input.frame.pressed(a), softWorld());
      softs.step(dt, softWorld());
      syncWatchers(dt);
      modes.update(dt);
      events.flush();
      mission.update(dt);
      syncHudVis();
      if (!overlayPaint()) paintWorld(1);
    },
    paint() {
      syncHudVis();
      if (overlayPaint()) {
        interlude?.update(0);
        modes.render(1);
        hud.update(0);
        return;
      }
      paintWorld(1);
    },
  };

  opts.effectsSlot.current = effects;
  await showBriefThenJack(opts.checkpoint);

  root.dataset.mission = 'm4';
  root.dataset.heat = String(heat0);
  (window as unknown as { __nonspaceMission?: TuringHandle }).__nonspaceMission = handle;

  const run: TuringMission = {
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
      softs.handleInput((a) => input.frame.pressed(a), softWorld());
      softs.step(dt, softWorld());
      syncWatchers(dt);
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
      const w = window as unknown as { __nonspaceMission?: TuringHandle };
      if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      unbindAudio?.();
      interlude?.dispose();
      interior?.dispose();
      visuals?.dispose();
      field.dispose();
      streak.dispose();
      scene.dispose();
      hud.dispose();
      flight.collision.remove('m4-ice');
      jackIn = null;
    },
  };

  return run;
}
