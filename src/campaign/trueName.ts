import { openSettings } from '../a11y/host';
import { createWintermute, type Wintermute } from '../ai/Wintermute';
import { createNeuromancer, type Neuromancer } from '../ai/Neuromancer';
import { createPersona, type Persona } from '../ai/Persona';
import { createDeckPanelMode, type DeckPanelMode } from '../app/modes/DeckPanel';
import { createInterludeMode } from '../app/modes/Interlude';
import { createJackInMode, type JackInMode } from '../app/modes/JackIn';
import { createMatrixMode } from '../app/modes/Matrix';
import { createSimstimMode } from '../app/modes/Simstim';
import type { ModeStack } from '../app/ModeStack';
import { SFX_IDS, type AudioEngine, type SfxId } from '../audio/AudioEngine';
import { bindSfxToEvents } from '../audio/sfx/bind';
import { createDixie, ERASE_PROMPT, type Dixie } from '../companion/Dixie';
import { getLandmark, landmarkWorldPos } from '../content/landmarks';
import { loadCampaignMission } from '../content/missions/load';
import {
  M7_CLUSTER,
  M7_HEAD_AT,
  M7_NEAR,
  M7_START,
  M7_WORD,
  M7_WORD_SPOKEN_AT,
  M7_WORD_WINDOW_S,
  trueNameIce,
  wordMatches,
} from '../content/missions/m7';
import { STRAYLIGHT_M7_GATES, straylightM7Timeline } from '../content/simstim/straylight';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createHud, type Hud } from '../hud/Hud';
import { createSubtitles, type Subtitles } from '../hud/dom/Subtitles';
import type { InputFrame, InputService } from '../input/Input';
import { createInterlude, type Interlude } from '../meat/Interlude';
import type { InkStory } from '../narrative/InkRuntime';
import type { MissionEffects, MissionRunner } from '../narrative/MissionRunner';
import { poseFromForward, type FlightController } from '../player/FlightController';
import type { CameraRig } from '../player/CameraRig';
import { sphereHull } from '../player/Collision';
import { createIceVisuals, type IceVisuals } from '../breach/IceVisuals';
import { createIceModel, type IceModel } from '../breach/IceModel';
import type { PersistencePass } from '../render/post/PersistencePass';
import { asVectorCrtPass } from '../render/post/VectorCrtPass';
import type { Renderer } from '../render/Renderer';
import { createSimstimRenderer } from '../render/simstim/SimstimRenderer';
import type { SimstimFeed } from '../simstim/SimstimFeed';
import { formatMatrixCoord, matrixCoordToWorld, worldToMatrixCoord } from '../world/coords';
import { createKuang, type Kuang } from '../world/Kuang';
import { createEndingCredits, type EndingCredits } from './credits';
import { createMergeFx, MERGE_DURATION, type MergeFx } from './merge';
import { createKuangScene } from './kuangScene';
import m7Ink from '../content/ink/m7.json';

export type TrueNamePhase =
  | 'brief'
  | 'jackIn'
  | 'core'
  | 'simstim'
  | 'word'
  | 'frozen'
  | 'merge'
  | 'erase'
  | 'epilogue'
  | 'coda'
  | 'credits';

export interface TrueNameHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: TrueNamePhase;
  knot: string | null;
  ended: boolean;
  won: boolean;
  failed: boolean;
  frozen: boolean;
  word: string;
  wordHeard: boolean;
  wordIn: boolean;
  subtitle: string;
  deckOpen: boolean;
  deckLabel: string;
  erasePrompt: boolean;
  erased: boolean | null;
  mergeT: number;
  mergePhase: string;
  ending: 'A' | 'B' | null;
  complete: boolean;
  laugh: boolean;
  skipBrief(): void;
  skipJackIn(): void;
  choose(n: number): boolean;
  flip(on?: boolean): void;
  playWordScene(): void;
  openDeck(): void;
  typeWord(raw: string): boolean;
  missWordWindow(): void;
  retry(): void;
  startMerge(): void;
  seekMerge(t: number): void;
  completeMerge(): void;
  answerErase(yes: boolean): boolean;
  skipEpilogue(): void;
  enterCoda(): void;
  skipToCredits(): void;
  skipOverlay(): void;
  advance(dt: number): void;
  paint(): void;
}

export interface TrueNameMission {
  readonly handle: TrueNameHandle;
  readonly effects: MissionEffects;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface TrueNameMissionOptions {
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

function clusterWorld(): { x: number; y: number; z: number } {
  const def = getLandmark(M7_CLUSTER);
  return def ? landmarkWorldPos(def.coords) : matrixCoordToWorld({ ...M7_START, y: 5600, z: 40 });
}

export async function startTrueNameMission(opts: TrueNameMissionOptions): Promise<TrueNameMission> {
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

  const persist = renderer.chain.getPass('persistence') as PersistencePass | undefined;
  if (persist && 'decayScale' in persist) persist.decayScale = 1;

  let audio: AudioEngine | null = null;
  let unbindAudio: (() => void) | null = null;
  let dixieVoice: { bark(id: string): void; laugh(): void } | null = null;
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

  const subtitles: Subtitles = createSubtitles({ settings, events, hold: 6 });
  subtitles.mount(root);

  const scene = createKuangScene(renderer, flight.collision);
  scene.setVisible(false);

  const icePos = clusterWorld();
  const iceDef = trueNameIce();
  flight.collision.add(sphereHull('m7-ice', 'ice', icePos.x, icePos.y, icePos.z, 22));

  const displayIce: IceModel = createIceModel(iceDef, { seed: 23 });
  const visuals: IceVisuals | null = createIceVisuals({
    renderer,
    def: iceDef,
    x: icePos.x,
    y: icePos.y,
    z: icePos.z,
  });
  if (visuals) visuals.object.visible = false;

  const view = createSimstimRenderer(renderer);
  const timeline = straylightM7Timeline();
  const wordGates = STRAYLIGHT_M7_GATES.map((g) =>
    g.id === 'word-window' ? { ...g, late: M7_WORD_WINDOW_S } : { ...g },
  );
  simstim.load(timeline, wordGates);
  view.load(timeline);
  const simstimMode = createSimstimMode(simstim, view);

  const kuang: Kuang = createKuang({ renderer, pose: 'deploy', mimic: 1, reveal: 1 });
  kuang.object.visible = false;
  kuang.object.position.set(icePos.x, icePos.y + 6, icePos.z + 18);

  const wmPortrait: Persona = createPersona(renderer.palette, { scale: 10 });
  const nmPortrait: Persona = createPersona(renderer.palette, { scale: 9 });
  renderer.scenes.matrix.add(wmPortrait.object);
  renderer.scenes.matrix.add(nmPortrait.object);

  const merge: MergeFx = createMergeFx({
    palette: renderer.palette,
    grid: scene.grid,
    fold: (a) => scene.fold(a),
    wintermute: wmPortrait,
    neuromancer: nmPortrait,
    reduceFlashing: () => settings.value.reduceFlashing,
    origin: icePos,
  });

  const wm: Wintermute = createWintermute({
    palette: renderer.palette,
    renderer,
    save,
    hud,
    ice: displayIce,
    grid: scene.grid,
  });

  const nm: Neuromancer = createNeuromancer({
    palette: renderer.palette,
    flight,
  });

  const dixie: Dixie = createDixie({
    events,
    save,
    voice: dixieVoice,
    aboard: true,
    onDeckPrompt: (text) => hud.print(text),
  });

  const credits: EndingCredits = createEndingCredits(root);

  let jackIn: JackInMode | null = null;
  let interlude: Interlude | null = null;
  let deckMode: DeckPanelMode | null = null;
  let region = 'ORBT';
  let ended = false;
  let disposed = false;
  let frozen = false;
  let wordWindowOpen = false;
  let wordDeadline = 0;
  let wordHeard = false;
  let laughPlayed = false;
  let codaOn = false;
  let merging = false;
  let lastSubtitle = '';

  const player = (): { x: number; y: number; z: number } => ({
    x: flight.pose.x,
    y: flight.pose.y,
    z: flight.pose.z,
  });
  const look = (): { x: number; y: number; z: number } => flight.forward(FWD);

  const overlayPaint = (): boolean => {
    const id = modes.top?.id;
    return id === 'interlude' || id === 'jackIn' || id === 'jackOut' || id === 'simstim';
  };

  const syncHudVis = (): void => {
    const id = modes.top?.id;
    renderer.scenes.hud.visible =
      id !== 'interlude' && id !== 'jackIn' && id !== 'jackOut' && !credits.visible;
  };

  const phaseOf = (): TrueNamePhase => {
    if (credits.visible) return 'credits';
    if (codaOn) return 'coda';
    if (modes.has('interlude')) {
      const knot = interlude?.info.knot;
      if (knot === 'brief') return 'brief';
      return 'epilogue';
    }
    if (modes.has('jackIn')) return 'jackIn';
    if (frozen) return 'frozen';
    if (dixie.erasePrompt) return 'erase';
    if (merging || merge.t > 0) return merge.t >= MERGE_DURATION ? 'erase' : 'merge';
    if (wordWindowOpen) return 'word';
    if (simstim.flipped || modes.has('simstim')) return 'simstim';
    return 'core';
  };

  const paintHud = (): void => {
    const p = player();
    const coord = worldToMatrixCoord(p.x, p.y, p.z, region);
    hud.setCoords(formatMatrixCoord(coord));
    hud.setSpeed(flight.telemetry.speed);
    hud.setNeural(0);
    hud.setTrace(0);
    hud.setScars(0);
    hud.setFlatline(false);
    hud.setPipLink(simstim.linkLive && !simstim.flipped);
    hud.setGrip(null);
    if (simstim.flipped) hud.setMode('SIMSTIM');
    else if (merging) hud.setMode('MERGE');
    else if (frozen) hud.setMode('ICE');
    else if (kuang.object.visible) hud.setMode('KUANG');
    else hud.setMode('TRANSIT');
    hud.setBlips([
      {
        angle: Math.atan2(icePos.z - p.z, icePos.x - p.x),
        radius: Math.min(1, Math.hypot(icePos.x - p.x, icePos.z - p.z) / 8000),
        kind: 'ice',
      },
    ]);
    hud.update(0);
  };

  const paintWorld = (alpha = 1): void => {
    cameraRig.apply(flight, alpha);
    const cam = renderer.cameras.matrix.position;
    scene.follow(cam, renderer.quality.latticeRadius);
    scene.paint();
    if (visuals && visuals.object.visible) {
      visuals.update(
        0,
        displayIce,
        renderer.cameras.matrix,
        settings.value.reduceMotion,
        settings.value.reduceFlashing,
      );
    }
    if (kuang.object.visible) kuang.paint();
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
        modes.top.id === 'simstim' ||
        modes.top.id === 'jackOut' ||
        modes.top.id === 'jackIn' ||
        modes.top.id === 'interlude' ||
        modes.top.id === 'boot')
    ) {
      modes.pop();
    }
    deckMode = null;
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
    kuang.object.visible = true;
  };

  const poseAtCluster = (): void => {
    const from = {
      x: icePos.x + 220,
      y: icePos.y + 40,
      z: icePos.z + 280,
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

  const deployKuang = (): void => {
    kuang.object.visible = true;
    kuang.pose = 'deploy';
    kuang.reveal = 1;
    kuang.mimic = 1;
    kuang.object.position.set(icePos.x, icePos.y + 6, icePos.z + 18);
    kuang.paint();
  };

  const doFlip = (on: boolean): void => {
    if (on === simstim.flipped && on === modes.has('simstim')) return;
    mission.meatTimeRunning = on || wordWindowOpen;
    simstim.setFlipped(on);
    if (on) {
      if (!modes.has('simstim')) modes.push(simstimMode);
      audio?.sfx('simstimFlip');
    } else if (modes.has('simstim')) {
      modes.pop();
    }
  };

  const speakLines = (): void => {
    for (const line of simstim.timeline.firedLines) {
      lastSubtitle = line.text;
      const who = line.who === '3jane' ? '3JANE' : line.who.toUpperCase();
      subtitles.show(`${who}> ${line.text}`);
      if (wordMatches(line.text)) {
        wordHeard = true;
        wordWindowOpen = true;
        wordDeadline = mission.meatTime + M7_WORD_WINDOW_S;
        if (deckMode) deckMode.panel.setCoordLabel('WORD');
      }
    }
    const live = simstim.debug.line;
    if (live && live !== lastSubtitle) {
      lastSubtitle = live;
      if (wordMatches(live)) {
        wordHeard = true;
        wordWindowOpen = true;
        wordDeadline = Math.max(wordDeadline, mission.meatTime + M7_WORD_WINDOW_S);
      }
    }
  };

  const acceptWord = (): void => {
    if (mission.flag('word-in')) return;
    wordWindowOpen = false;
    frozen = false;
    displayIce.setFrozen(false);
    wm.apply({ kind: 'freeze', on: false });
    simstim.crack('straylight-word');
    events.flush();
    mission.update(0);
    hud.print('TRUE NAME');
    audio?.sfx('shatter');
    if (modes.has('deckPanel')) modes.pop();
    deckMode = null;
    doFlip(false);
    startMergeNow();
  };

  const onRawSubmit = (raw: string): boolean | string => {
    if (!wordWindowOpen || frozen || merging) return false;
    if (wordMatches(raw)) {
      acceptWord();
      return true;
    }
    return 'WRONG WORD';
  };

  const openDeck = (): void => {
    if (modes.has('deckPanel') || merging || credits.visible) return;
    deckMode = createDeckPanelMode({
      input,
      events,
      campaign: () => save.data.campaign,
      onRawSubmit,
      onError: () => audio?.sfx('deckError'),
      onSettings: () => openSettings(),
    });
    deckMode.panel.setLink(simstim.linkLive);
    deckMode.panel.setInRun(true);
    if (wordWindowOpen) deckMode.panel.setCoordLabel('WORD');
    modes.push(deckMode);
  };

  function onMatrixInput(frame: InputFrame): void {
    if (frame.pressed('simstim')) doFlip(!simstim.flipped);
    if (frame.pressed('deck')) openDeck();
    if (dixie.erasePrompt) {
      const v = frame.textValue?.trim().toUpperCase();
      if (v === 'Y' || frame.pressed('soft1')) dixie.answerErase(true);
      if (v === 'N' || frame.pressed('soft2')) dixie.answerErase(false);
    }
  }

  const startMergeNow = (): void => {
    if (merging && merge.t > 0) return;
    merging = true;
    dropOverlay();
    pushMatrix();
    doFlip(false);
    merge.start();
    nm.apply({ kind: 'soften', amount: 1 });
    audio?.sfx('kuangSting');
    audio?.music.setState('core');
    hud.print('MERGE');
    root.dataset.merge = '1';
  };

  const finishMerge = (): void => {
    merging = false;
    merge.seek(MERGE_DURATION);
    events.post({ type: 'downloadProgress', targetId: 'merge', value: 1 });
    events.flush();
    mission.update(0);
    dixie.startErase();
    hud.print(ERASE_PROMPT);
    root.dataset.erase = '1';
  };

  const freezeIce = (): void => {
    if (frozen) return;
    frozen = true;
    wordWindowOpen = false;
    merging = false;
    displayIce.setFrozen(true);
    wm.apply({ kind: 'freeze', on: true });
    events.post({ type: 'gateWindow', gateId: 'word-window', state: 'missed' });
    events.flush();
    mission.update(0);
    hud.print('ICE RE-FREEZE');
    audio?.sfx('burned');
    root.dataset.frozen = '1';
  };

  const retryFromWord = (): void => {
    frozen = false;
    merging = false;
    codaOn = false;
    ended = false;
    laughPlayed = false;
    credits.hide();
    merge.reset();
    displayIce.setFrozen(false);
    wm.apply({ kind: 'freeze', on: false });
    wm.reset();
    nm.reset();
    dropOverlay();
    try {
      mission.restoreCheckpoint('word');
    } catch {
      /* still running */
    }
    simstim.reset();
    simstim.load(timeline, wordGates);
    view.load(timeline);
    simstim.attachMission(mission);
    poseAtCluster();
    deployKuang();
    pushMatrix();
    mission.meatTimeRunning = true;
    let guard = 0;
    while (mission.meatTime < M7_WORD_SPOKEN_AT && guard++ < 4000) {
      mission.update(0.25);
      simstim.update(0.25);
    }
    simstim.crack('straylight-head');
    events.flush();
    mission.update(0);
    wordHeard = true;
    wordWindowOpen = true;
    wordDeadline = mission.meatTime + M7_WORD_WINDOW_S;
    lastSubtitle = M7_WORD;
    subtitles.show(`3JANE> ${M7_WORD}`);
    hud.print('RETRY. TYPE THE WORD.');
    root.dataset.frozen = '0';
    root.dataset.phase = 'word';
  };

  const showEpilogue = (): void => {
    dropOverlay();
    interlude?.dispose();
    const knot = dixie.erased === true ? 'erased' : dixie.erased === false ? 'kept' : 'epilogue';
    interlude = createInterlude({
      story: m7Ink as InkStory,
      audio: audio ?? undefined,
      onChange(info) {
        root.dataset.knot = info.knot;
        if (info.ended && interlude) {
          const last = info.knot;
          if (last === 'coda_offer' || last === 'credits') return;
        }
      },
    });
    interlude.ink.goto(knot);
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
  };

  const markComplete = (): void => {
    events.post({ type: 'downloadProgress', targetId: 'ending-a', value: 1 });
    events.flush();
    mission.update(0);
    save.data.campaign.flags.endingA = true;
    save.data.campaign.flags.complete = true;
    save.data.campaign.act = 5;
    save.data.campaign.missionId = 'm7';
    save.commit();
    ended = true;
    root.dataset.ending = 'A';
    root.dataset.complete = '1';
  };

  const showCredits = (): void => {
    dropOverlay();
    codaOn = false;
    pushMatrix();
    renderer.scenes.hud.visible = false;
    credits.show();
    markComplete();
    hud.print('NONSPACE');
  };

  const enterCodaNow = (): void => {
    dropOverlay();
    codaOn = true;
    pushMatrix();
    merge.seek(MERGE_DURATION);
    wmPortrait.setWho('finn', true);
    nmPortrait.setWho('linda', true);
    wmPortrait.setPose(icePos.x - 420, icePos.y + 48, icePos.z - 920, 5);
    nmPortrait.setPose(icePos.x + 390, icePos.y + 36, icePos.z - 880, 5);
    if (!laughPlayed) {
      laughPlayed = true;
      dixieVoice?.laugh();
      dixie.say({
        id: 'coda-laugh',
        text: 'A laugh. Far off.',
        critical: true,
        laugh: true,
      });
    }
    hud.print('...');
    root.dataset.coda = '1';
  };

  const bindLandmarks = (): void => {
    for (const lm of scene.landmarks) mission.setLandmark(lm.id, lm.x, lm.y, lm.z);
  };

  const beginJackIn = (checkpoint?: string): void => {
    interlude?.dispose();
    interlude = null;
    jackIn = createJackInMode({
      variant: 'short',
      missionId: 'm7',
      emit: true,
      onDone() {
        jackIn = null;
        poseAtCluster();
        deployKuang();
        pushMatrix();
        void audio?.unlock();
        if (checkpoint === 'word' || checkpoint === 'merge') playWordNow();
        if (checkpoint === 'merge' || checkpoint === 'erase' || checkpoint === 'epilogue') {
          acceptWord();
          if (checkpoint !== 'merge') merge.seek(MERGE_DURATION);
          if (checkpoint === 'erase' || checkpoint === 'epilogue') finishMerge();
          if (checkpoint === 'epilogue') {
            dixie.answerErase(true);
            showEpilogue();
          }
        }
      },
    });
    modes.reset(jackIn);
    if (checkpoint && checkpoint !== 'core') jackIn.seek(jackIn.sequence.duration);
  };

  const playWordNow = (): void => {
    doFlip(true);
    mission.meatTimeRunning = true;
    let guard = 0;
    while (mission.meatTime < M7_HEAD_AT && guard++ < 4000) {
      mission.update(0.25);
      simstim.update(0.25);
    }
    simstim.crack('straylight-head');
    events.flush();
    mission.update(0);
    guard = 0;
    while (mission.meatTime < M7_WORD_SPOKEN_AT && guard++ < 4000) {
      mission.update(0.25);
      simstim.update(0.25);
      speakLines();
    }
    speakLines();
    wordHeard = true;
    wordWindowOpen = true;
    wordDeadline = mission.meatTime + M7_WORD_WINDOW_S;
    lastSubtitle = M7_WORD;
    subtitles.show(`3JANE> ${M7_WORD}`);
    const sample = simstim.sample();
    view.apply(sample, simstim.overlay, simstim.meatTime);
  };

  const showBriefThenJack = async (checkpoint?: string): Promise<void> => {
    const def = await loadCampaignMission('m7');
    if (!def) return;
    interlude?.dispose();
    interlude = null;
    ended = false;
    mission.load(def);
    bindLandmarks();
    poseAtCluster();
    simstim.attachMission(mission);
    opts.effectsSlot.current = effects;
    mission.meatTimeRunning = false;
    mission.start(checkpoint ? { checkpoint } : undefined);
    poseAtCluster();
    if (!checkpoint || checkpoint === 'core') {
      interlude = createInterlude({
        story: m7Ink as InkStory,
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

  const pickCredits = (): boolean => {
    if (!interlude) return false;
    const cred = interlude.ink.state.choices.find((c) => /CREDITS/i.test(c.text));
    if (cred) return interlude.choose(cred.index);
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
        state === 'simstim' ||
        state === 'kuangDive' ||
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
      nm.apply(action);
    },
  };

  const tickWordFail = (): void => {
    if (!wordWindowOpen || frozen || mission.flag('word-in')) return;
    if (mission.meatTime > wordDeadline) freezeIce();
  };

  const tickMerge = (dt: number): void => {
    if (!merging) return;
    merge.update(dt);
    if (merge.t >= MERGE_DURATION) finishMerge();
  };

  const handle: TrueNameHandle = {
    get missionId() {
      return mission.def?.id ?? 'm7';
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
      return mission.status === 'won' || save.data.campaign.flags.endingA === true;
    },
    get failed() {
      return frozen || mission.status === 'failed';
    },
    get frozen() {
      return frozen;
    },
    get word() {
      return M7_WORD;
    },
    get wordHeard() {
      return wordHeard;
    },
    get wordIn() {
      return mission.flag('word-in');
    },
    get subtitle() {
      return lastSubtitle || subtitles.visible;
    },
    get deckOpen() {
      return modes.has('deckPanel');
    },
    get deckLabel() {
      return deckMode?.panel.coordLabel ?? 'COORD';
    },
    get erasePrompt() {
      return dixie.erasePrompt;
    },
    get erased() {
      return dixie.erased;
    },
    get mergeT() {
      return merge.t;
    },
    get mergePhase() {
      return merge.sample.phase;
    },
    get ending() {
      if (save.data.campaign.flags.endingA) return 'A';
      if (save.data.campaign.flags.endingB) return 'B';
      return null;
    },
    get complete() {
      return save.data.campaign.flags.complete === true;
    },
    get laugh() {
      return laughPlayed;
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
    flip(on = true) {
      doFlip(on);
    },
    playWordScene() {
      if (interlude && modes.has('interlude')) handle.skipJackIn();
      jackIn?.seek(jackIn.sequence.duration);
      playWordNow();
    },
    openDeck() {
      doFlip(false);
      openDeck();
    },
    typeWord(raw) {
      if (!modes.has('deckPanel')) openDeck();
      const panel = deckMode?.panel;
      if (!panel) return false;
      panel.setCoordLabel('WORD');
      return panel.submitRaw(raw);
    },
    missWordWindow() {
      if (!wordHeard) playWordNow();
      mission.meatTimeRunning = true;
      let guard = 0;
      const target = wordDeadline + 0.5;
      while (mission.meatTime < target && guard++ < 4000) {
        handle.advance(0.5);
      }
      if (!frozen) freezeIce();
    },
    retry: retryFromWord,
    startMerge: startMergeNow,
    seekMerge(t) {
      if (!merging && !mission.flag('word-in')) acceptWord();
      merging = true;
      merge.seek(t);
      if (t >= MERGE_DURATION) finishMerge();
    },
    completeMerge() {
      if (!mission.flag('word-in')) acceptWord();
      merging = true;
      merge.seek(MERGE_DURATION);
      finishMerge();
    },
    answerErase(yes) {
      if (!dixie.erasePrompt) dixie.startErase();
      const ok = dixie.answerErase(yes);
      if (ok) {
        events.post({ type: 'downloadProgress', targetId: 'erase', value: yes ? 1 : 0 });
        events.flush();
        mission.update(0);
        showEpilogue();
      }
      return ok;
    },
    skipEpilogue() {
      if (!interlude || !modes.has('interlude')) showEpilogue();
      let guard = 8;
      while (interlude && modes.has('interlude') && guard-- > 0) {
        if (pickCredits()) {
          showCredits();
          break;
        }
        if (pickJackIn()) {
          enterCodaNow();
          break;
        }
        if (!interlude.choose(1)) break;
      }
    },
    enterCoda() {
      if (interlude && modes.has('interlude')) {
        if (!pickJackIn()) interlude.choose(1);
      }
      enterCodaNow();
    },
    skipToCredits: showCredits,
    skipOverlay() {
      if (interlude && modes.has('interlude')) {
        if (!pickJackIn() && !pickCredits()) interlude.choose(1);
      } else if (jackIn) jackIn.seek(jackIn.sequence.duration);
    },
    advance(dt) {
      const top = modes.top?.id;
      if (top === 'matrix' || top === 'deckPanel') {
        flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (kuang.object.visible) kuang.update(dt, settings.value.reduceMotion);
      nm.update(dt);
      wm.update(dt);
      dixie.update(dt);
      scene.core.updateVisuals(dt);
      tickMerge(dt);
      modes.update(dt);
      events.flush();
      mission.update(dt);
      simstim.update(0);
      speakLines();
      tickWordFail();
      syncHudVis();
      if (!overlayPaint() && !credits.visible) paintWorld(1);
      root.dataset.phase = phaseOf();
    },
    paint() {
      syncHudVis();
      if (credits.visible) {
        modes.render(1);
        return;
      }
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

  root.dataset.mission = 'm7';
  root.dataset.word = M7_WORD;
  (window as unknown as { __nonspaceMission?: TrueNameHandle }).__nonspaceMission = handle;

  const run: TrueNameMission = {
    handle,
    effects,
    update(dt) {
      if (disposed) return;
      const top = modes.top?.id;
      if (top === 'matrix' || top === 'deckPanel') {
        flight.step(input.frame, dt, { reduceMotion: settings.value.reduceMotion });
      }
      mission.setPlayerPosition(flight.pose.x, flight.pose.y, flight.pose.z);
      if (kuang.object.visible) kuang.update(dt, settings.value.reduceMotion);
      nm.update(dt);
      wm.update(dt);
      dixie.update(dt);
      scene.core.updateVisuals(dt);
      tickMerge(dt);
      speakLines();
      tickWordFail();
      if (audio) {
        const f = look();
        audio.listener(player(), f, { x: 0, y: 1, z: 0 });
      }
    },
    render(alpha) {
      if (disposed) return;
      syncHudVis();
      if (credits.visible || overlayPaint()) return;
      paintWorld(alpha);
    },
    dispose() {
      disposed = true;
      const w = window as unknown as { __nonspaceMission?: TrueNameHandle };
      if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      unbindAudio?.();
      interlude?.dispose();
      visuals?.dispose();
      kuang.dispose();
      merge.dispose();
      scene.dispose();
      hud.dispose();
      subtitles.dispose();
      credits.dispose();
      wm.dispose();
      nm.dispose();
      dixie.dispose();
      flight.collision.remove('m7-ice');
      jackIn = null;
    },
  };

  return run;
}

export { MERGE_DURATION, M7_NEAR };
