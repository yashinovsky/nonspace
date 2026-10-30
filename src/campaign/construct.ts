import { createWintermute, type Wintermute } from '../ai/Wintermute';
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
import { barkOccupancy } from '../companion/barks';
import { asDixieReadApi, createDixie, type Dixie } from '../companion/Dixie';
import { GRAY_ICE } from '../content/ice/gray';
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { loadCampaignMission } from '../content/missions/load';
import {
  M3_BACK_LINE,
  M3_BERNE,
  M3_BERNE_LINE,
  M3_CORTO_LINE,
  M3_HIJACK,
  M3_HOSAKA,
  M3_ICE_ID,
  M3_MIMIC_LINE,
  M3_ONBOARD,
  M3_ONBOARD_S,
  M3_RECORD,
  M3_START,
} from '../content/missions/m3';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createSoftsRuntime, type SoftsRuntime, type SoftsWorld } from '../deck/softs/registry';
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
import { createConstructScene } from './constructScene';
import { createTendril, TENDRIL_DURATION, type Tendril } from './tendril';
import m3Ink from '../content/ink/m3.json';

export type ConstructPhase =
  | 'jackIn'
  | 'onboard'
  | 'hosaka'
  | 'breach'
  | 'core'
  | 'berne'
  | 'tendril'
  | 'flatline'
  | 'hijack'
  | 'out';

export interface ConstructHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: ConstructPhase;
  knot: string | null;
  ended: boolean;
  won: boolean;
  onboarded: boolean;
  scars: number;
  scriptedFlatline: boolean;
  hijackText: string;
  dixieLine: string;
  tendrilPhase: string;
  engaged: boolean;
  downloaded: boolean;
  skipJackIn(): void;
  skipOnboarding(): void;
  choose(n: number): boolean;
  jumpToHosaka(): boolean;
  jumpToBerne(): boolean;
  completeJump(): void;
  engage(): boolean;
  askDixie(): boolean;
  useMimic(): boolean;
  crack(): void;
  completeDownload(): void;
  leaveCore(): void;
  triggerTendril(): void;
  completeTendril(): void;
  skipOverlay(): void;
  jackOut(): void;
  forceFlatline(scripted?: boolean): void;
  advance(dt: number): void;
  paint(): void;
}

export interface ConstructMission {
  readonly handle: ConstructHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface ConstructMissionOptions {
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

function hosakaWorld(): { x: number; y: number; z: number } {
  const def = getLandmark(M3_HOSAKA);
  return def ? landmarkWorldPos(def.coords) : { x: 0, y: 280, z: 0 };
}

function berneWorld(): { x: number; y: number; z: number } {
  const def = getLandmark(M3_BERNE);
  return def ? landmarkWorldPos(def.coords) : { x: 0, y: 3200, z: 0 };
}

function startWorld(): { x: number; y: number; z: number } {
  return matrixCoordToWorld(M3_START);
}

export async function startConstructMission(
  opts: ConstructMissionOptions,
): Promise<ConstructMission> {
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
  let dixieVoice: { bark(lineId: string): void; laugh(): void } | null = null;
  try {
    const { createAudioEngine, getAudioEngineHandle } = await import('../audio/AudioEngine');
    audio = createAudioEngine({ settings });
    unbindAudio = bindSfxToEvents(events, audio);
    dixieVoice = getAudioEngineHandle(audio)?.dixie() ?? null;
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

  const scene = createConstructScene(renderer, flight.collision);
  scene.setVisible(false);
  const icePos = hosakaWorld();
  const bernePos = berneWorld();
  flight.collision.add(sphereHull('m3-ice', 'ice', icePos.x, icePos.y, icePos.z, 14));

  const iceAnchor = (): IceAnchor => ({
    def: GRAY_ICE,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
    seed: 11,
  });

  const displayIce: IceModel = createIceModel(GRAY_ICE, { seed: 11 });
  const visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: GRAY_ICE,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const breach = createBreachController({ events, save, audio: audio ?? undefined });
  breach.neural.reset(8);
  breach.neural.setScars(0);
  breach.trace.reset(4);
  breach.markCheckpoint();

  const dixie: Dixie = createDixie({
    events,
    save,
    voice: dixieVoice,
    iceRatio: () => (breach.ice ?? displayIce).state.current.ratio,
    aboard: true,
    onDeckPrompt: (text) => hud.print(text),
  });

  const softs: SoftsRuntime = createSoftsRuntime();
  softs.beginRun({
    act: 2,
    slots: ['probe', 'mimic', 'clamp', 'decoy'],
  });

  const wm: Wintermute = createWintermute({
    palette: renderer.palette,
    renderer,
    save,
  });

  const tendril: Tendril = createTendril(renderer, bernePos, { x: 0, y: -1, z: 0 });

  let interior: CoreInterior | null = null;
  let jackIn: JackInMode | null = null;
  let jackOutMode: JackOutMode | null = null;
  let flatlineMode: FlatlineMode | null = null;
  let interlude: Interlude | null = null;
  let region = 'BAMA';
  let downloaded = false;
  let ended = false;
  let disposed = false;
  let onboardIndex = 0;
  let taughtMimic = false;
  let saidCorto = false;
  let saidBerne = false;
  let scriptedOnce = false;
  let hijacked = false;
  let hosakaPose: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

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
    dixie: asDixieReadApi(dixie),
  });

  const phaseOf = (): ConstructPhase => {
    if (modes.has('jackIn')) return 'jackIn';
    if (modes.has('jackOut') || modes.has('interlude')) return 'out';
    if (modes.has('flatline')) return 'flatline';
    if (hijacked || hud.hijackText) return 'hijack';
    if (tendril.started && !tendril.done) return 'tendril';
    if (modes.has('core')) return 'core';
    if (breach.engaged) return 'breach';
    if (mission.flag('at-berne')) return 'berne';
    if (mission.flag('onboarded') || mission.flag('at-hosaka')) return 'hosaka';
    return 'onboard';
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
    } else {
      hud.setMode(phaseOf() === 'berne' || phaseOf() === 'tendril' ? 'APPROACH' : 'TRANSIT');
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
        kind: (lm.id === M3_HOSAKA || lm.id === M3_BERNE ? 'ice' : 'target') as 'ice' | 'target',
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
    interior?.paint();
    tendril.paint();
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
    if (visuals) visuals.object.visible = !interior;
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

  const poseAtLandmark = (world: { x: number; y: number; z: number }, nextRegion: string): void => {
    const arr = jumpArrival(startWorld(), world);
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
    region = nextRegion;
    mission.setPlayerPosition(arr.x, arr.y, arr.z);
  };

  const fireHijack = (): void => {
    if (hijacked) return;
    hijacked = true;
    wm.apply({ kind: 'hijack', text: M3_HIJACK });
    events.post({ type: 'wintermute', action: { kind: 'hijack', text: M3_HIJACK } });
    events.flush();
    mission.update(0);
    hud.hijack(M3_HIJACK);
  };

  const startScriptedFlatline = (): void => {
    if (scriptedOnce || modes.has('flatline')) return;
    scriptedOnce = true;
    dropOverlay();
    breach.forceFlatline(true);
    events.flush();
    mission.update(0);
    flatlineMode = createFlatlineMode({
      breach,
      scripted: true,
      onDone() {
        flatlineMode = null;
        dropOverlay();
        pushMatrix();
        hud.setFlatline(false);
        dixie.say(M3_BACK_LINE);
        fireHijack();
      },
    });
    modes.push(flatlineMode);
  };

  const enterCore = (): void => {
    if (interior) return;
    visuals?.shatter(7);
    if (visuals) visuals.object.visible = false;
    scene.setVisible(false);
    interior = createCoreInterior({
      events,
      trace: breach.trace,
      heat: breach.heat,
      def: { seed: 11, strata: 8, targetRecord: M3_RECORD, layers: 2, downloadHold: 3 },
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
          leaveCore();
        },
        onBurned() {
          beginJackOut('burned');
        },
      }),
    );
    hud.print('CORE OPEN');
  };

  const leaveCore = (): void => {
    dropOverlay();
    interior?.dispose();
    interior = null;
    renderer.cameras.matrix.far = 80_000;
    renderer.cameras.matrix.updateProjectionMatrix();
    if (hosakaPose) {
      flight.setPose({
        ...hosakaPose,
        vx: 0,
        vy: 0,
        vz: 0,
        fov: flight.params.fovBase,
      });
      region = 'BAMA';
      mission.setPlayerPosition(hosakaPose.x, hosakaPose.y, hosakaPose.z);
    } else {
      poseAtLandmark(icePos, 'BAMA');
    }
    scene.setVisible(true);
    pushMatrix();
  };

  const showDebrief = async (): Promise<void> => {
    dropOverlay();
    interlude?.dispose();
    interlude = createInterlude({
      story: m3Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
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
        void showDebrief();
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
          visuals?.shatter(7);
          enterCore();
        },
        onFlatline(scripted) {
          if (scripted) startScriptedFlatline();
          else {
            dropOverlay();
            flatlineMode = createFlatlineMode({
              breach,
              scripted: false,
              onDone() {
                flatlineMode = null;
                poseAtLandmark(icePos, 'BAMA');
                pushMatrix();
              },
            });
            modes.push(flatlineMode);
          }
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

  function onMatrixInput(frame: InputFrame): void {
    if (jump.active) return;
    if (frame.pressed('scan')) {
      events.post({
        type: 'scanPulse',
        origin: { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z },
      });
      events.flush();
      hud.print(`SCAN  ${M3_ICE_ID}`);
    }
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

  const tickOnboard = (): void => {
    while (onboardIndex < M3_ONBOARD.length) {
      const row = M3_ONBOARD[onboardIndex]!;
      if (mission.time < row.at) break;
      dixie.say(row.line);
      onboardIndex += 1;
    }
  };

  const tickStory = (): void => {
    tickOnboard();
    if (!taughtMimic && dixie.lastLineId === 'ice-read') {
      dixie.say(M3_MIMIC_LINE);
      taughtMimic = true;
    }
    if (!saidCorto && mission.flag('got-corto')) {
      dixie.say(M3_CORTO_LINE);
      saidCorto = true;
    }
    if (!saidBerne && mission.flag('at-berne')) {
      dixie.say(M3_BERNE_LINE);
      saidBerne = true;
    }
    if (mission.flag('at-berne') && !tendril.started && !scriptedOnce) {
      const p = player();
      tendril.origin = bernePos;
      tendril.axis = { x: p.x - bernePos.x, y: p.y - bernePos.y - 40, z: p.z - bernePos.z };
      tendril.start();
    }
    if (tendril.done && !scriptedOnce && mission.flag('at-berne')) {
      startScriptedFlatline();
    }
  };

  const startM3 = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m3');
    if (!def) return;
    mission.load(def);
    bindLandmarks();
    poseAtStart();
    mission.start(checkpoint ? { checkpoint } : undefined);
    if (checkpoint === 'hosaka' || checkpoint === 'core') poseAtLandmark(icePos, 'BAMA');
    if (checkpoint === 'berne' || checkpoint === 'hijack') poseAtLandmark(bernePos, 'EURO');
    if (checkpoint === 'onboard') mission.update(M3_ONBOARD_S);
    jackIn = createJackInMode({
      variant: def.start.jackInSequence,
      missionId: 'm3',
      emit: false,
      onDone() {
        jackIn = null;
        pushMatrix();
        void audio?.unlock();
        if (checkpoint === 'core') enterCore();
        if (checkpoint === 'hijack') {
          scriptedOnce = true;
          dixie.say(M3_BACK_LINE);
          fireHijack();
        }
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'start') jackIn.seek(jackIn.sequence.duration);
  };

  const effects: MissionEffects = {
    say(who, line) {
      if (who === 'dixie') {
        dixie.say({ id: `m3-say`, text: line, critical: true, laugh: /laugh/i.test(line) });
        return;
      }
      hud.print(who === 'wintermute' ? line : line);
    },
    wintermute(action) {
      wm.apply(action);
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

  const handle: ConstructHandle = {
    get missionId() {
      return mission.def?.id ?? 'm3';
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
      return ended || mission.status === 'won';
    },
    get won() {
      return mission.status === 'won';
    },
    get onboarded() {
      return mission.flag('onboarded');
    },
    get scars() {
      return breach.neural.scars;
    },
    get scriptedFlatline() {
      return scriptedOnce;
    },
    get hijackText() {
      return hud.hijackText || wm.hijackText;
    },
    get dixieLine() {
      return dixie.lastLine;
    },
    get tendrilPhase() {
      return tendril.phase;
    },
    get engaged() {
      return breach.engaged;
    },
    get downloaded() {
      return downloaded || mission.flag('got-corto');
    },
    skipJackIn() {
      jackIn?.seek(jackIn.sequence.duration);
    },
    skipOnboarding() {
      for (const row of M3_ONBOARD) {
        dixie.say(row.line);
        dixie.update(barkOccupancy(row.line.text) + 0.05);
      }
      onboardIndex = M3_ONBOARD.length;
      if (mission.time < M3_ONBOARD_S) mission.update(M3_ONBOARD_S - mission.time);
    },
    choose(n) {
      return interlude?.choose(n) ?? false;
    },
    jumpToHosaka() {
      return doJump(M3_HOSAKA);
    },
    jumpToBerne() {
      return doJump(M3_BERNE);
    },
    completeJump() {
      const dest = jump.targetWorld;
      jump.seek(jump.duration);
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (dest) {
        const dH = Math.hypot(dest.x - icePos.x, dest.y - icePos.y, dest.z - icePos.z);
        const dB = Math.hypot(dest.x - bernePos.x, dest.y - bernePos.y, dest.z - bernePos.z);
        if (dH < dB) {
          hosakaPose = {
            x: flight.pose.x,
            y: flight.pose.y,
            z: flight.pose.z,
            yaw: flight.pose.yaw,
            pitch: flight.pose.pitch,
          };
          region = 'BAMA';
        } else {
          region = 'EURO';
        }
      }
      events.flush();
      mission.update(0);
    },
    engage: doEngage,
    askDixie() {
      forceEngage();
      return softs.askDixie(softWorld()).ok;
    },
    useMimic() {
      forceEngage();
      return softs.use('mimic', softWorld()).ok;
    },
    crack() {
      forceEngage();
      const ice = breach.ice;
      if (!ice) return;
      let guard = 8;
      while (ice.state.status === 'engaged' && guard-- > 0) ice.crack();
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
    leaveCore,
    triggerTendril() {
      if (tendril.started) return;
      const p = player();
      tendril.origin = bernePos;
      tendril.axis = { x: p.x - bernePos.x, y: p.y - bernePos.y - 40, z: p.z - bernePos.z };
      tendril.start();
    },
    completeTendril() {
      if (!tendril.started) {
        const p = player();
        tendril.origin = bernePos;
        tendril.axis = { x: p.x - bernePos.x, y: p.y - bernePos.y - 40, z: p.z - bernePos.z };
        tendril.start();
      }
      tendril.seek(TENDRIL_DURATION);
      startScriptedFlatline();
    },
    skipOverlay() {
      if (jackIn) jackIn.seek(jackIn.sequence.duration);
      else if (modes.has('jackOut') && jackOutMode) {
        jackOutMode.seek(jackOutMode.collapse.duration);
      } else if (modes.has('flatline') && flatlineMode) {
        flatlineMode.seek(FLATLINE_TIMING.total);
      }
    },
    jackOut() {
      beginJackOut('player');
      events.flush();
      mission.update(0);
    },
    forceFlatline(scripted = true) {
      if (scripted) startScriptedFlatline();
      else {
        breach.forceFlatline(false);
        dropOverlay();
        flatlineMode = createFlatlineMode({
          breach,
          scripted: false,
          onDone() {
            flatlineMode = null;
            pushMatrix();
          },
        });
        modes.push(flatlineMode);
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
      const ice = liveIce();
      ice.state.lockDecayScale = dixie.lockDecayScale;
      softs.handleInput((a) => input.frame.pressed(a), softWorld());
      softs.step(dt, softWorld());
      if (breach.ice && breach.engaged) softs.applyMimic(breach.knobs, breach.ice, dt);
      dixie.update(dt);
      wm.update(dt);
      tendril.update(dt);
      modes.update(dt);
      events.flush();
      mission.update(dt);
      tickStory();
      syncHudVis();
      if (!overlayPaint()) paintWorld(1);
    },
    paint() {
      syncHudVis();
      if (overlayPaint()) {
        modes.render(1);
        hud.update(0);
        return;
      }
      paintWorld(1);
    },
  };

  opts.effectsSlot.current = effects;
  await startM3(opts.checkpoint);

  root.dataset.mission = 'm3';
  (window as unknown as { __nonspaceMission?: ConstructHandle }).__nonspaceMission = handle;

  const run: ConstructMission = {
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
      const ice = liveIce();
      ice.state.lockDecayScale = dixie.lockDecayScale;
      softs.handleInput((a) => input.frame.pressed(a), softWorld());
      softs.step(dt, softWorld());
      if (breach.ice && breach.engaged) softs.applyMimic(breach.knobs, breach.ice, dt);
      dixie.update(dt);
      wm.update(dt);
      tendril.update(dt);
      tickStory();
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
      const w = window as unknown as { __nonspaceMission?: ConstructHandle };
      if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      unbindAudio?.();
      dixie.dispose();
      wm.dispose();
      tendril.dispose();
      interlude?.dispose();
      interior?.dispose();
      visuals?.dispose();
      streak.dispose();
      scene.dispose();
      hud.dispose();
      flight.collision.remove('m3-ice');
      jackIn = null;
    },
  };

  return run;
}
