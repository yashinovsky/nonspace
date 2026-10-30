import type { NeuromancerAction } from '../ai/Neuromancer';
import type { WintermuteAction } from '../ai/Wintermute';
import type { ModeId } from '../app/ModeStack';
import {
  MUSIC_STATES,
  SFX_IDS,
  type AudioEngine,
  type MusicState,
  type SfxId,
} from '../audio/AudioEngine';
import type { IceLayerDef } from '../breach/IceModel';
import type { EventBus, GameEvent, GameEventType, Unsubscribe } from '../core/events';
import type { SaveStore } from '../core/save';
import { parseMission, type Action, type MissionDef, type Trigger } from './schema';
import {
  collectSeek,
  compileMission,
  evalTrigger,
  latchEvent,
  type CompiledMission,
  type TriggerWorld,
} from './triggers';

export const OBJECTIVE_STATES = ['inactive', 'active', 'done', 'failed'] as const;
export type ObjectiveState = (typeof OBJECTIVE_STATES)[number];

export type MissionStatus = 'idle' | 'running' | 'won' | 'failed';

const OBJ = { inactive: 0, active: 1, done: 2, failed: 3 } as const;
const OBJ_NAME = OBJECTIVE_STATES;
const MAX_PUMPS = 10_000;

const MUSIC_SET: ReadonlySet<string> = new Set(MUSIC_STATES);
const SFX_SET: ReadonlySet<string> = new Set(SFX_IDS);

export interface MissionEffects {
  say?(who: Extract<Action, { a: 'say' }>['who'], line: string): void;
  ink?(knot: string): void;
  iceMod?(iceId: string, patch: Partial<IceLayerDef>): void;
  wintermute?(action: WintermuteAction): void;
  neuromancer?(action: NeuromancerAction): void;
  forceMode?(mode: ModeId): void;
  music?(state: string): void;
  sfx?(id: string): void;
}

export interface MissionSnapshot {
  missionId: string;
  time: number;
  meatTime: number;
  flags: Record<string, boolean>;
  objectives: Record<string, ObjectiveState>;
  timelineFired: number[];
  checkpointsFired: number[];
  eventLatch: number[];
  icePatches: Array<{ ice: string; patch: Partial<IceLayerDef> }>;
  failed: boolean;
  won: boolean;
  checkpointId: string | null;
  lastForcedMode: ModeId | null;
}

/** Bindable readout for the debug GUI. Fields are mutated in place. */
export interface MissionDebug {
  id: string;
  status: MissionStatus;
  time: number;
  meatTime: number;
  checkpoint: string;
}

export interface MissionRunnerOptions {
  events: EventBus;
  effects?: MissionEffects;
  audio?: AudioEngine;
  save?: SaveStore;
  /** If given, loaded immediately (not started). */
  mission?: unknown;
}

export interface MissionRunner {
  readonly def: MissionDef | null;
  readonly status: MissionStatus;
  readonly time: number;
  readonly meatTime: number;
  readonly checkpointId: string | null;
  readonly failed: boolean;
  readonly debug: MissionDebug;
  /** When false, `update` does not advance this clock. */
  timeRunning: boolean;
  meatTimeRunning: boolean;
  load(data: unknown): MissionDef;
  start(opts?: { checkpoint?: string }): void;
  stop(): void;
  /** Advance clocks (when running) and evaluate script. `dt` is seconds. */
  update(dt: number): void;
  setPlayerPosition(x: number, y: number, z: number): void;
  setLandmark(id: string, x: number, y: number, z: number): void;
  flag(name: string): boolean;
  objective(id: string): ObjectiveState;
  icePatch(iceId: string): Partial<IceLayerDef> | undefined;
  snapshot(): MissionSnapshot;
  restore(snap: MissionSnapshot): void;
  checkpointSnapshot(id: string): MissionSnapshot | undefined;
  restoreCheckpoint(id: string): void;
  /**
   * Restore a captured snapshot, or seek by satisfying the checkpoint
   * trigger (debug `?checkpoint=`).
   */
  jumpToCheckpoint(id: string): void;
  serialize(): string;
  deserialize(json: string): void;
  dispose(): void;
}

export function createMissionRunner(opts: MissionRunnerOptions): MissionRunner {
  const { events, effects, audio, save } = opts;

  let def: MissionDef | null = null;
  let compiled: CompiledMission | null = null;
  let status: MissionStatus = 'idle';
  let timeRunning = true;
  let meatTimeRunning = true;
  let checkpointId: string | null = null;
  let lastForcedMode: ModeId | null = null;
  let pumping = false;
  let dirty = false;
  let failed = false;
  let won = false;

  const world: TriggerWorld = {
    time: 0,
    meatTime: 0,
    flags: {},
    hasPos: false,
    posX: 0,
    posY: 0,
    posZ: 0,
    landmarks: new Map(),
  };

  let latched = new Uint8Array(0);
  let timelineFired = new Uint8Array(0);
  let checkpointsFired = new Uint8Array(0);
  let objectiveState = new Uint8Array(0);
  const icePatches = new Map<string, Partial<IceLayerDef>>();
  const snapshots = new Map<string, MissionSnapshot>();
  const objectiveIndex = new Map<string, number>();

  const debug: MissionDebug = {
    id: '(idle)',
    status: 'idle',
    time: 0,
    meatTime: 0,
    checkpoint: '',
  };

  const refreshDebug = (): void => {
    debug.id = def?.id ?? '(idle)';
    debug.status = status;
    debug.time = world.time;
    debug.meatTime = world.meatTime;
    debug.checkpoint = checkpointId ?? '';
  };

  const evalRoot = (root: number): boolean => evalTrigger(compiled!.nodes, root, world, latched);

  const latchIncoming = (event: GameEvent): boolean => {
    if (!compiled) return false;
    return latchEvent(compiled.nodes, compiled.eventNodes, event, latched);
  };

  const dispatch = (event: GameEvent): void => {
    if (latchIncoming(event)) dirty = true;
    events.post(event);
  };

  const setObjective = (index: number, next: ObjectiveState): boolean => {
    const code = OBJ[next];
    if (objectiveState[index] === code) return false;
    objectiveState[index] = code;
    if (next !== 'inactive') {
      const id = def!.objectives[index]!.id;
      dispatch({ type: 'objective', id, state: next });
    }
    dirty = true;
    return true;
  };

  const setObjectiveById = (id: string, next: ObjectiveState): void => {
    const index = objectiveIndex.get(id);
    if (index === undefined) return;
    setObjective(index, next);
  };

  const applyIceMod = (ice: string, patch: Partial<IceLayerDef>): void => {
    const prev = icePatches.get(ice) ?? {};
    const merged = { ...prev, ...patch };
    icePatches.set(ice, merged);
    effects?.iceMod?.(ice, patch);
  };

  const applyAction = (action: Action): void => {
    switch (action.a) {
      case 'setFlag':
        if (world.flags[action.name] !== action.value) {
          world.flags[action.name] = action.value;
          dirty = true;
        }
        break;
      case 'objective':
        setObjectiveById(action.id, action.state);
        break;
      case 'say':
        effects?.say?.(action.who, action.line);
        if (action.who === 'dixie') dispatch({ type: 'dixieSay', lineId: action.line });
        break;
      case 'ink':
        effects?.ink?.(action.knot);
        break;
      case 'iceMod':
        applyIceMod(action.ice, action.patch);
        break;
      case 'wintermute':
        effects?.wintermute?.(action.action);
        dispatch({ type: 'wintermute', action: action.action });
        break;
      case 'neuromancer':
        effects?.neuromancer?.(action.action);
        dispatch({ type: 'neuromancer', action: action.action });
        break;
      case 'forceMode':
        lastForcedMode = action.mode;
        effects?.forceMode?.(action.mode);
        break;
      case 'music':
        effects?.music?.(action.state);
        if (audio && MUSIC_SET.has(action.state)) {
          audio.music.setState(action.state as MusicState);
        }
        break;
      case 'sfx':
        effects?.sfx?.(action.id);
        if (audio && SFX_SET.has(action.id)) audio.sfx(action.id as SfxId);
        break;
    }
  };

  const evalObjectives = (): void => {
    if (!def || !compiled) return;
    for (let i = 0; i < def.objectives.length; i++) {
      const state = objectiveState[i]!;
      if (state === OBJ.inactive && evalRoot(compiled.objectiveWhen[i]!)) {
        setObjective(i, 'active');
      }
      if (objectiveState[i] === OBJ.active && evalRoot(compiled.objectiveComplete[i]!)) {
        setObjective(i, 'done');
      }
    }
  };

  const evalTimeline = (): void => {
    if (!def || !compiled || failed) return;
    for (let i = 0; i < def.timeline.length; i++) {
      if (timelineFired[i]) continue;
      if (!evalRoot(compiled.timelineAt[i]!)) continue;
      timelineFired[i] = 1;
      const row = def.timeline[i]!;
      for (let a = 0; a < row.do.length; a++) applyAction(row.do[a]!);
    }
  };

  const captureCheckpoint = (id: string): void => {
    checkpointId = id;
    snapshots.set(id, takeSnapshot());
    if (save && def) {
      save.data.campaign.missionId = def.id;
      save.data.campaign.checkpoint = id;
      save.data.campaign.act = def.act;
      Object.assign(save.data.campaign.flags, world.flags);
      save.commit();
    }
    refreshDebug();
  };

  const evalCheckpoints = (): void => {
    if (!def || !compiled) return;
    for (let i = 0; i < def.checkpoints.length; i++) {
      if (checkpointsFired[i]) continue;
      if (!evalRoot(compiled.checkpointAt[i]!)) continue;
      checkpointsFired[i] = 1;
      captureCheckpoint(def.checkpoints[i]!.id);
    }
  };

  const requiredIncomplete = (): boolean => {
    if (!def) return false;
    for (let i = 0; i < def.objectives.length; i++) {
      if (def.objectives[i]!.optional) continue;
      const s = objectiveState[i];
      if (s !== OBJ.done) return true;
    }
    return false;
  };

  const failMission = (): void => {
    if (failed) return;
    failed = true;
    won = false;
    status = 'failed';
    if (def) {
      for (let i = 0; i < def.objectives.length; i++) {
        if (def.objectives[i]!.optional) continue;
        if (objectiveState[i] === OBJ.active) setObjective(i, 'failed');
      }
    }
    dirty = true;
  };

  const evalFail = (): void => {
    if (!def || !compiled || failed) return;
    for (let i = 0; i < compiled.failAt.length; i++) {
      if (evalRoot(compiled.failAt[i]!)) {
        failMission();
        return;
      }
    }
    for (let i = 0; i < objectiveState.length; i++) {
      if (def.objectives[i]!.optional) continue;
      if (objectiveState[i] === OBJ.failed) {
        failMission();
        return;
      }
    }
  };

  const evalWin = (): void => {
    if (!def || failed || won) return;
    if (def.objectives.length === 0) return;
    if (!requiredIncomplete()) {
      won = true;
      status = 'won';
    }
  };

  const pump = (): void => {
    if (!compiled || status === 'idle') return;
    if (pumping) {
      dirty = true;
      return;
    }
    pumping = true;
    dirty = true;
    try {
      let n = 0;
      while (dirty) {
        if (++n > MAX_PUMPS) {
          throw new Error(
            `mission pump exceeded ${MAX_PUMPS} iterations; a script is re-triggering in a loop`,
          );
        }
        dirty = false;
        evalObjectives();
        evalTimeline();
        evalCheckpoints();
        evalFail();
        evalWin();
      }
    } finally {
      pumping = false;
      refreshDebug();
    }
  };

  const onEvent = (event: GameEvent): void => {
    if (status === 'idle' || !compiled) return;
    if (latchIncoming(event)) pump();
  };

  const stopListen: Unsubscribe = events.onAny(onEvent);

  const resetRuntime = (): void => {
    world.time = 0;
    world.meatTime = 0;
    world.hasPos = false;
    world.posX = 0;
    world.posY = 0;
    world.posZ = 0;
    for (const k of Object.keys(world.flags)) delete world.flags[k];
    icePatches.clear();
    snapshots.clear();
    checkpointId = null;
    lastForcedMode = null;
    failed = false;
    won = false;
    if (!compiled || !def) {
      latched = new Uint8Array(0);
      timelineFired = new Uint8Array(0);
      checkpointsFired = new Uint8Array(0);
      objectiveState = new Uint8Array(0);
      objectiveIndex.clear();
      return;
    }
    latched = new Uint8Array(compiled.nodes.length);
    timelineFired = new Uint8Array(def.timeline.length);
    checkpointsFired = new Uint8Array(def.checkpoints.length);
    objectiveState = new Uint8Array(def.objectives.length);
    objectiveIndex.clear();
    for (let i = 0; i < def.objectives.length; i++) {
      objectiveIndex.set(def.objectives[i]!.id, i);
    }
  };

  const takeSnapshot = (): MissionSnapshot => {
    const objectives: Record<string, ObjectiveState> = {};
    if (def) {
      for (let i = 0; i < def.objectives.length; i++) {
        objectives[def.objectives[i]!.id] = OBJ_NAME[objectiveState[i]!]!;
      }
    }
    return {
      missionId: def?.id ?? '',
      time: world.time,
      meatTime: world.meatTime,
      flags: { ...world.flags },
      objectives,
      timelineFired: Array.from(timelineFired),
      checkpointsFired: Array.from(checkpointsFired),
      eventLatch: Array.from(latched),
      icePatches: [...icePatches.entries()].map(([ice, patch]) => ({ ice, patch: { ...patch } })),
      failed,
      won,
      checkpointId,
      lastForcedMode,
    };
  };

  const applySnapshot = (snap: MissionSnapshot): void => {
    if (!def || snap.missionId !== def.id) {
      throw new Error(
        `snapshot mission '${snap.missionId}' does not match loaded '${def?.id ?? '(none)'}'`,
      );
    }
    world.time = snap.time;
    world.meatTime = snap.meatTime;
    for (const k of Object.keys(world.flags)) delete world.flags[k];
    Object.assign(world.flags, snap.flags);
    timelineFired.set(snap.timelineFired);
    checkpointsFired.set(snap.checkpointsFired);
    latched.set(snap.eventLatch);
    icePatches.clear();
    for (const { ice, patch } of snap.icePatches) {
      icePatches.set(ice, { ...patch });
      effects?.iceMod?.(ice, patch);
    }
    for (let i = 0; i < def.objectives.length; i++) {
      const id = def.objectives[i]!.id;
      const next = snap.objectives[id] ?? 'inactive';
      objectiveState[i] = OBJ[next];
    }
    failed = snap.failed;
    won = snap.won;
    checkpointId = snap.checkpointId;
    lastForcedMode = snap.lastForcedMode;
    if (failed) status = 'failed';
    else if (won) status = 'won';
    else status = 'running';
    if (lastForcedMode) effects?.forceMode?.(lastForcedMode);
    refreshDebug();
  };

  const seekTrigger = (trigger: Trigger): void => {
    const pending: Array<{ type: GameEventType; where?: Record<string, unknown> }> = [];
    collectSeek(trigger, world, pending);
    for (const spec of pending) {
      const event = synthesizeGameEvent(spec.type, spec.where ?? {}, def?.id ?? '');
      latchIncoming(event);
      events.post(event);
    }
    dirty = true;
  };

  const jumpToCheckpoint = (id: string): void => {
    if (!def) throw new Error('jumpToCheckpoint() without a loaded mission');
    const existing = snapshots.get(id);
    if (existing) {
      applySnapshot(existing);
      return;
    }
    const cp = def.checkpoints.find((c) => c.id === id);
    if (!cp) throw new Error(`unknown checkpoint '${id}'`);
    seekTrigger(cp.at);
    pump();
    if (!snapshots.has(id)) throw new Error(`checkpoint '${id}' did not fire after seek`);
  };

  const runner: MissionRunner = {
    get def() {
      return def;
    },
    get status() {
      return status;
    },
    get time() {
      return world.time;
    },
    get meatTime() {
      return world.meatTime;
    },
    get checkpointId() {
      return checkpointId;
    },
    get failed() {
      return failed;
    },
    get debug() {
      return debug;
    },
    get timeRunning() {
      return timeRunning;
    },
    set timeRunning(v) {
      timeRunning = v;
    },
    get meatTimeRunning() {
      return meatTimeRunning;
    },
    set meatTimeRunning(v) {
      meatTimeRunning = v;
    },
    load(data) {
      const parsed = parseMission(data);
      def = parsed;
      compiled = compileMission(parsed);
      status = 'idle';
      resetRuntime();
      world.landmarks.clear();
      for (const id of parsed.landmarks) {
        world.landmarks.set(id, { x: 0, y: 0, z: 0 });
      }
      refreshDebug();
      return parsed;
    },
    start(startOpts) {
      if (!def || !compiled) throw new Error('start() without a loaded mission');
      status = 'running';
      resetRuntime();
      refreshDebug();
      events.emit({ type: 'jackIn', missionId: def.id });
      if (startOpts?.checkpoint) jumpToCheckpoint(startOpts.checkpoint);
    },
    stop() {
      status = 'idle';
      refreshDebug();
    },
    update(dt) {
      if (status === 'idle' || !(dt >= 0)) return;
      if (timeRunning && dt > 0) world.time += dt;
      if (meatTimeRunning && dt > 0) world.meatTime += dt;
      pump();
    },
    setPlayerPosition(x, y, z) {
      world.posX = x;
      world.posY = y;
      world.posZ = z;
      world.hasPos = true;
      if (status !== 'idle') pump();
    },
    setLandmark(id, x, y, z) {
      const existing = world.landmarks.get(id);
      if (existing) {
        existing.x = x;
        existing.y = y;
        existing.z = z;
      } else {
        world.landmarks.set(id, { x, y, z });
      }
      if (status !== 'idle') pump();
    },
    flag(name) {
      return world.flags[name] === true;
    },
    objective(id) {
      const i = objectiveIndex.get(id);
      if (i === undefined) return 'inactive';
      return OBJ_NAME[objectiveState[i]!]!;
    },
    icePatch(iceId) {
      return icePatches.get(iceId);
    },
    snapshot: takeSnapshot,
    restore(snap) {
      if (!def) throw new Error('restore() without a loaded mission');
      applySnapshot(snap);
    },
    checkpointSnapshot(id) {
      return snapshots.get(id);
    },
    restoreCheckpoint(id) {
      const snap = snapshots.get(id);
      if (!snap) throw new Error(`no captured checkpoint '${id}'`);
      applySnapshot(snap);
    },
    jumpToCheckpoint,
    serialize() {
      return JSON.stringify(takeSnapshot());
    },
    deserialize(json) {
      applySnapshot(JSON.parse(json) as MissionSnapshot);
    },
    dispose() {
      stopListen();
      status = 'idle';
      def = null;
      compiled = null;
    },
  };

  if (opts.mission !== undefined) runner.load(opts.mission);
  return runner;
}

export function synthesizeGameEvent(
  type: GameEventType,
  where: Record<string, unknown> = {},
  missionId = '',
): GameEvent {
  const base = defaultGameEvent(type, missionId);
  return { ...base, ...where, type } as GameEvent;
}

function defaultGameEvent(type: GameEventType, missionId: string): GameEvent {
  switch (type) {
    case 'jackIn':
      return { type, missionId };
    case 'jackOut':
      return { type, reason: 'script' };
    case 'flatline':
      return { type, scripted: false };
    case 'modeChanged':
      return { type, from: 'matrix', to: 'breach' };
    case 'scanPulse':
      return { type, origin: { x: 0, y: 0, z: 0 } };
    case 'iceEngaged':
      return { type, iceId: '', layer: 0 };
    case 'iceRekeyTelegraph':
      return { type, iceId: '', inSeconds: 0 };
    case 'iceRekey':
      return { type, iceId: '' };
    case 'iceLayerCracked':
      return { type, iceId: '', layer: 0 };
    case 'gripStart':
    case 'gripEnd':
      return { type, iceId: '' };
    case 'traceChanged':
    case 'neuralChanged':
      return { type, value: 0 };
    case 'downloadProgress':
      return { type, targetId: '', value: 0 };
    case 'simstimFlip':
      return { type, on: true };
    case 'gateWindow':
      return { type, gateId: '', state: 'open' };
    case 'mollyPain':
      return { type, amount: 0 };
    case 'softUsed':
      return { type, softId: '' };
    case 'dixieSay':
      return { type, lineId: '' };
    case 'wintermute':
      return { type, action: { kind: 'freeze', on: true } };
    case 'neuromancer':
      return { type, action: { kind: 'beach' } };
    case 'objective':
      return { type, id: '', state: 'active' };
    case 'beachChoice':
      return { type, choice: 'leave' };
  }
}
