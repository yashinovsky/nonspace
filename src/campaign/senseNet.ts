import { openSettings } from '../a11y/host';
import { createBreachMode } from '../app/modes/Breach';
import { createDeckPanelMode, DEFAULT_ADDRESS_BOOK } from '../app/modes/DeckPanel';
import { createFlatlineMode, FLATLINE_TIMING, type FlatlineMode } from '../app/modes/Flatline';
import { createInterludeMode } from '../app/modes/Interlude';
import { createJackInMode, type JackInMode } from '../app/modes/JackIn';
import { createJackOutMode, type JackOutMode } from '../app/modes/JackOut';
import { createMatrixMode } from '../app/modes/Matrix';
import { createSimstimMode } from '../app/modes/Simstim';
import type { ModeStack } from '../app/ModeStack';
import { SFX_IDS, type AudioEngine, type SfxId } from '../audio/AudioEngine';
import { bindSfxToEvents } from '../audio/sfx/bind';
import { createBreachController, JACK_OUT_HOLD, type IceAnchor } from '../breach/BreachController';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { createIceModel, type IceLayerDef, type IceModel } from '../breach/IceModel';
import { loadCampaignMission } from '../content/missions/load';
import {
  applySenseNetRekey,
  gateIceNode,
  M2_ICE_ID,
  M2_START,
  senseNetIce,
} from '../content/missions/m2';
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { SENSE_NET_CAMPAIGN_GATES, senseNetCampaignTimeline } from '../content/simstim/senseNet';
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
import { createSimstimRenderer } from '../render/simstim/SimstimRenderer';
import type { SimstimFeed } from '../simstim/SimstimFeed';
import { formatMatrixCoord, matrixCoordToWorld, worldToMatrixCoord } from '../world/coords';
import { createChibaScene } from './chibaScene';
import m2Ink from '../content/ink/m2.json';

export interface SenseNetHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  knot: string | null;
  ended: boolean;
  won: boolean;
  failed: boolean;
  caught: boolean;
  panic: boolean;
  gates: string;
  meatTime: number;
  clock: string;
  rekeyEvery: [number, number] | null;
  flipped: boolean;
  exposure: number;
  skipJackIn(): void;
  choose(n: number): boolean;
  scan(): void;
  jumpToSenseNet(): boolean;
  completeJump(): void;
  engage(): boolean;
  crack(): void;
  crackGate(id: string): void;
  flip(on?: boolean): void;
  seekMeat(t: number): void;
  jackOut(): void;
  skipOverlay(): void;
  forceFlatline(): void;
  forceMollyCaught(): void;
  retry(): void;
  advance(dt: number): void;
  paint(): void;
}

export interface SenseNetMission {
  readonly handle: SenseNetHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface SenseNetMissionOptions {
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

function senseNetWorld(): { x: number; y: number; z: number } {
  const def = getLandmark('sense-net');
  return def ? landmarkWorldPos(def.coords) : { x: 0, y: 420, z: 0 };
}

function startWorld(): { x: number; y: number; z: number } {
  return matrixCoordToWorld(M2_START);
}

export async function startSenseNetMission(opts: SenseNetMissionOptions): Promise<SenseNetMission> {
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
  hud.setPipLink(true);
  hud.setMode('TRANSIT');

  const scene = createChibaScene(renderer, flight.collision);
  scene.setVisible(false);
  const icePos = senseNetWorld();
  flight.collision.add(sphereHull('m2-ice', 'ice', icePos.x, icePos.y, icePos.z, 16));

  const iceDef = senseNetIce();
  const iceAnchor = (): IceAnchor => ({
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: 4,
  });

  let displayIce: IceModel = createIceModel(iceDef, { seed: 4 });
  let visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const breach = createBreachController({ events, save, settings, audio: audio ?? undefined });
  breach.neural.reset(10);
  breach.trace.reset(6);
  breach.markCheckpoint();

  const view = createSimstimRenderer(renderer);
  const timeline = senseNetCampaignTimeline();
  simstim.load(timeline, SENSE_NET_CAMPAIGN_GATES);
  view.load(timeline);
  const simstimMode = createSimstimMode(simstim, view);

  let jackIn: JackInMode | null = null;
  let jackOutMode: JackOutMode | null = null;
  let flatlineMode: FlatlineMode | null = null;
  let interlude: Interlude | null = null;
  let region = 'BAMA';
  let ended = false;
  let caught = false;
  let disposed = false;
  let showingCaught = false;
  let panicApplied = false;

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
  const liveIce = (): IceModel => breach.ice ?? displayIce;

  const currentRekey = (): [number, number] | null => {
    const layer = liveIce().def.layers[liveIce().state.current.index];
    const every = layer?.rekeyEvery;
    return every ? [every[0], every[1]] : null;
  };

  const syncPanicRekey = (): void => {
    const panic = mission.flag('panic');
    if (panic === panicApplied) return;
    panicApplied = panic;
    applySenseNetRekey(liveIce(), panic);
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
    hud.setPipLink(simstim.linkLive && !simstim.flipped);
    if (breach.grip.active) {
      hud.setMode('GRIP');
      hud.setGrip(breach.grip.remaining);
    } else if (simstim.flipped) {
      hud.setMode('FLIP');
      hud.setGrip(null);
    } else if (breach.engaged) {
      hud.setMode('BREACH');
      hud.setGrip(null);
    } else if (jump.active) {
      hud.setMode('JUMP');
      hud.setGrip(null);
      hud.setLock(null);
    } else {
      hud.setMode(mission.flag('at-sensenet') ? 'APPROACH' : 'TRANSIT');
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
        kind: (lm.id === 'sense-net' ? 'ice' : 'target') as 'ice' | 'target',
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
    return (
      id === 'interlude' ||
      id === 'jackIn' ||
      id === 'jackOut' ||
      id === 'flatline' ||
      id === 'simstim'
    );
  };

  const syncHudVis = (): void => {
    const id = modes.top?.id;
    renderer.scenes.hud.visible =
      id !== 'interlude' && id !== 'jackIn' && id !== 'jackOut' && id !== 'simstim';
  };

  const paintWorld = (alpha = 1): void => {
    cameraRig.apply(flight, alpha);
    const cam = renderer.cameras.matrix.position;
    scene.follow(cam, renderer.quality.latticeRadius);
    if (visuals)
      visuals.update(
        0,
        liveIce(),
        renderer.cameras.matrix,
        settings.value.reduceMotion,
        settings.value.reduceFlashing,
      );
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
        modes.top.id === 'simstim' ||
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
    region = 'BAMA';
  };

  const poseAtSenseNet = (): void => {
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
    region = 'BAMA';
    mission.setPlayerPosition(arr.x, arr.y, arr.z);
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
        void showDebrief();
      },
    });
    modes.push(jackOutMode);
  };

  const rebuildIce = (panic: boolean): void => {
    const fresh = senseNetIce();
    iceDef.layers.splice(0, iceDef.layers.length, ...fresh.layers);
    displayIce = createIceModel(iceDef, { seed: 4 });
    applySenseNetRekey(displayIce, panic);
    visuals?.dispose();
    visuals = createIceVisuals({
      renderer,
      def: displayIce.def,
      x: icePos.x,
      y: icePos.y,
      z: icePos.z,
    });
  };

  const retryFromCheckpoint = (): void => {
    dropOverlay();
    caught = false;
    showingCaught = false;
    ended = false;
    const cp = mission.checkpointId;
    if (cp && cp !== 'start') {
      try {
        mission.restoreCheckpoint(cp);
      } catch {
        /* still running */
      }
    }
    if (cp === 'approach' || cp === 'lobby' || cp === 'panic' || cp === 'vault') poseAtSenseNet();
    else poseAtStart();
    breach.restoreCheckpoint();
    panicApplied = mission.flag('panic');
    rebuildIce(panicApplied);
    simstim.reset();
    simstim.load(senseNetCampaignTimeline(), SENSE_NET_CAMPAIGN_GATES);
    view.load(simstim.timeline.def ?? timeline);
    simstim.attachMission(mission);
    precrackForCheckpoint(cp);
    mission.meatTimeRunning = true;
    simstim.update(0);
    scene.setVisible(true);
    pushMatrix();
    hud.print('RETRY');
    hud.setFlatline(false);
    root.dataset.mission = 'm2';
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

  const showCaught = (): void => {
    if (showingCaught) return;
    showingCaught = true;
    dropOverlay();
    interlude?.dispose();
    interlude = createInterlude({
      story: m2Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        root.dataset.knot = info.knot;
        if (info.ended) retryFromCheckpoint();
      },
    });
    interlude.ink.goto('caught');
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
  };

  const showDebrief = async (): Promise<void> => {
    dropOverlay();
    interlude?.dispose();
    interlude = createInterlude({
      story: m2Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        if (info.ended) ended = true;
      },
    });
    interlude.ink.goto('debrief');
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
  };

  const doScan = (): void => {
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
    hud.print(`SCAN  GRAY ICE  ${d.toFixed(0)} U  ${M2_ICE_ID}`);
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
        reduceFlashing: () => settings.value.reduceFlashing,
        onCracked() {
          /* layers map to gates via iceLayerCracked listener */
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

  const pumpGates = (): void => {
    events.flush();
    simstim.update(0);
    events.flush();
    mission.update(0);
    simstim.update(0);
  };

  const crackCurrent = (): void => {
    forceEngage();
    const ice = breach.ice;
    if (!ice) return;
    ice.crack();
    pumpGates();
  };

  const crackNamedGate = (id: string): void => {
    const def = SENSE_NET_CAMPAIGN_GATES.find((g) => g.id === id || g.iceNode === id);
    const node = def?.iceNode ?? id;
    simstim.crack(node);
    pumpGates();
  };

  const precrackForCheckpoint = (cp: string | null): void => {
    if (cp === 'lobby' || cp === 'panic' || cp === 'vault') crackNamedGate('lobby-door');
    if (cp === 'panic' || cp === 'vault') crackNamedGate('corridor-lock');
    if (cp === 'vault') crackNamedGate('vault-seal');
  };

  const doJumpSenseNet = (): boolean => {
    const def = getLandmark('sense-net');
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
        onSettings: () => openSettings(),
      }),
    );
  };

  const maybeFlip = (frame: InputFrame): void => {
    if (overlayPaint() && modes.top?.id !== 'breach' && modes.top?.id !== 'matrix') return;
    if (modes.top?.id === 'simstim') return;
    if (!frame.pressed('simstim')) return;
    simstim.setFlipped(true);
    if (!modes.has('simstim')) modes.push(simstimMode);
  };

  function onMatrixInput(frame: InputFrame): void {
    if (jump.active) return;
    maybeFlip(frame);
    if (frame.pressed('scan')) doScan();
    if (frame.pressed('engage')) doEngage();
    if (frame.pressed('deck')) openDeck();
    if (frame.held('jackOut') >= JACK_OUT_HOLD) {
      if (flight.jackOutBlocked || breach.grip.active) hud.print("DECK WON'T LET GO");
      else beginJackOut('player');
    }
  }

  const bindLandmarks = (): void => {
    for (const lm of scene.landmarks) mission.setLandmark(lm.id, lm.x, lm.y, lm.z);
  };

  events.on('iceLayerCracked', (e) => {
    if (e.iceId !== M2_ICE_ID) return;
    const node = gateIceNode(e.layer);
    if (!node) return;
    simstim.crack(node);
  });

  events.on('gateWindow', (e) => {
    if (e.state !== 'missed') return;
    caught = true;
    hud.print('MOLLY CAUGHT');
  });

  const showBriefThenJack = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m2');
    if (!def) return;
    interlude?.dispose();
    interlude = null;
    ended = false;
    caught = false;
    mission.load(def);
    bindLandmarks();
    poseAtStart();
    simstim.attachMission(mission);
    opts.effectsSlot.current = effects;
    mission.meatTimeRunning = false;
    mission.start(checkpoint ? { checkpoint } : undefined);
    if (
      checkpoint === 'approach' ||
      checkpoint === 'lobby' ||
      checkpoint === 'panic' ||
      checkpoint === 'vault'
    ) {
      poseAtSenseNet();
    }
    precrackForCheckpoint(checkpoint ?? null);
    simstim.update(0);

    if (!checkpoint || checkpoint === 'start') {
      interlude = createInterlude({
        story: m2Ink as InkStory,
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

  const beginJackIn = (checkpoint?: string): void => {
    interlude?.dispose();
    interlude = null;
    jackIn = createJackInMode({
      variant: 'short',
      missionId: 'm2',
      emit: false,
      onDone() {
        jackIn = null;
        mission.meatTimeRunning = true;
        pushMatrix();
        void audio?.unlock();
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'start') jackIn.seek(jackIn.sequence.duration);
  };

  const effects: MissionEffects = {
    say(who, line) {
      if (who === 'dixie') return;
      hud.print(line);
    },
    iceMod(iceId, _patch: Partial<IceLayerDef>) {
      if (iceId !== M2_ICE_ID) return;
      syncPanicRekey();
    },
    music(state) {
      if (
        state === 'silent' ||
        state === 'transit' ||
        state === 'approach' ||
        state === 'breach' ||
        state === 'simstim' ||
        state === 'core'
      ) {
        audio?.music.setState(state);
      }
    },
    sfx(id) {
      if ((SFX_IDS as readonly string[]).includes(id)) audio?.sfx(id as SfxId);
    },
  };

  const handle: SenseNetHandle = {
    get missionId() {
      return mission.def?.id ?? 'm2';
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
    get knot() {
      return interlude?.info.knot ?? null;
    },
    get ended() {
      return ended || mission.status === 'won';
    },
    get won() {
      return mission.status === 'won';
    },
    get failed() {
      return mission.status === 'failed' || caught;
    },
    get caught() {
      return caught;
    },
    get panic() {
      return mission.flag('panic');
    },
    get gates() {
      return simstim.gates.snapshots.map((s) => s.state).join(',');
    },
    get meatTime() {
      return simstim.meatTime;
    },
    get clock() {
      return simstim.debug.clock;
    },
    get rekeyEvery() {
      return currentRekey();
    },
    get flipped() {
      return simstim.flipped;
    },
    get exposure() {
      let e = 0;
      for (const g of simstim.gates.snapshots) if (g.exposure > e) e = g.exposure;
      return e;
    },
    skipJackIn() {
      if (interlude && modes.has('interlude')) {
        interlude.choose(1);
      }
      jackIn?.seek(jackIn.sequence.duration);
    },
    choose(n) {
      return interlude?.choose(n) ?? false;
    },
    scan: doScan,
    jumpToSenseNet: doJumpSenseNet,
    completeJump() {
      if (!jump.active && !doJumpSenseNet()) return;
      jump.seek(jump.duration);
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      events.flush();
      mission.update(0);
      simstim.update(0);
    },
    engage: doEngage,
    crack: crackCurrent,
    crackGate: crackNamedGate,
    flip(on = true) {
      if (on === simstim.flipped) return;
      simstim.setFlipped(on);
      if (on) {
        if (!modes.has('simstim')) modes.push(simstimMode);
      } else if (modes.has('simstim')) {
        modes.pop();
      }
    },
    seekMeat(t) {
      const step = 0.25;
      let guard = 0;
      while (mission.meatTime < t && guard++ < 4000) {
        handle.advance(Math.min(step, t - mission.meatTime));
      }
    },
    jackOut() {
      beginJackOut('player');
      events.flush();
      mission.update(0);
    },
    skipOverlay() {
      if (interlude && modes.has('interlude')) interlude.choose(1);
      else if (jackIn) jackIn.seek(jackIn.sequence.duration);
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
    forceMollyCaught() {
      events.post({ type: 'gateWindow', gateId: 'lobby-door', state: 'missed' });
      events.flush();
      mission.update(0);
      showCaught();
    },
    retry: retryFromCheckpoint,
    advance(dt) {
      if (jump.active) jump.step(dt);
      else {
        const top = modes.top?.id;
        if (top === 'matrix' || top === 'deckPanel' || top === 'breach' || top === 'simstim') {
          if (top === 'matrix' || top === 'deckPanel') {
            flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
          }
        }
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (visuals) {
        visuals.update(
          dt,
          liveIce(),
          renderer.cameras.matrix,
          settings.value.reduceMotion,
          settings.value.reduceFlashing,
        );
      }
      maybeFlip(input.frame);
      modes.update(dt);
      events.flush();
      mission.update(dt);
      syncPanicRekey();
      simstim.update(dt);
      if (mission.status === 'failed' && caught && !showingCaught && !modes.has('flatline')) {
        showCaught();
      }
      syncHudVis();
      if (!overlayPaint()) paintWorld(1);
    },
    paint() {
      syncHudVis();
      if (overlayPaint()) {
        modes.render(1);
        if (simstim.flipped) {
          const sample = simstim.sample();
          view.apply(sample, simstim.overlay, simstim.meatTime);
        }
        hud.update(0);
        return;
      }
      paintWorld(1);
    },
  };

  opts.effectsSlot.current = effects;
  await showBriefThenJack(opts.checkpoint);

  root.dataset.mission = 'm2';
  (window as unknown as { __nonspaceMission?: SenseNetHandle }).__nonspaceMission = handle;

  const run: SenseNetMission = {
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
      if (visuals) {
        visuals.update(
          dt,
          liveIce(),
          renderer.cameras.matrix,
          settings.value.reduceMotion,
          settings.value.reduceFlashing,
        );
      }
      maybeFlip(input.frame);
      if (audio) {
        const f = look();
        audio.listener(player(), f, { x: 0, y: 1, z: 0 });
      }
      if (mission.status === 'failed' && caught && !showingCaught && !modes.has('flatline')) {
        showCaught();
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
      const w = window as unknown as { __nonspaceMission?: SenseNetHandle };
      if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      unbindAudio?.();
      interlude?.dispose();
      visuals?.dispose();
      view.dispose();
      streak.dispose();
      scene.dispose();
      hud.dispose();
      flight.collision.remove('m2-ice');
      jackIn = null;
    },
  };

  return run;
}
