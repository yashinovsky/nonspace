import { Matrix4 } from 'three';
import { createNoopAudioEngine, type AudioEngine, type Handle } from '../audio/AudioEngine';
import type { EventBus, EventOf, GameEvent, GameEventType } from '../core/events';
import {
  createLineSet,
  DEFAULT_BEAM_INTENSITY,
  DEFAULT_BEAM_WIDTH,
  type BeamBatch,
  type LineSet,
} from '../render/lines/BeamBatch';
import {
  createPointSet,
  DEFAULT_POINT_SIZE,
  type PointBatch,
  type PointSet,
} from '../render/points/PointBatch';

/**
 * CPU-only test doubles for the §9 contracts. They need no WebGL or audio
 * device, so lanes can unit-test against them before the real modules land.
 */

export interface RecordingBeamBatch extends BeamBatch {
  staticSet: LineSet | null;
  /** Segments pushed since the last beginDynamic(), stored up to capacity. */
  readonly dynamic: Required<LineSet>;
  dynamicCount: number;
  /** Pushes dropped because the batch was full. */
  overflow: number;
  /** Completed beginDynamic/endDynamic pairs. */
  frames: number;
}

export function createRecordingBeamBatch(capacity = 1024): RecordingBeamBatch {
  const dynamic = createLineSet(capacity, { width: true, flags: true }) as Required<LineSet>;
  const batch: RecordingBeamBatch = {
    capacity,
    staticSet: null,
    dynamic,
    dynamicCount: 0,
    overflow: 0,
    frames: 0,
    transform: new Matrix4(),
    visible: true,
    setStatic(set) {
      batch.staticSet = set;
    },
    beginDynamic() {
      batch.dynamicCount = 0;
      batch.overflow = 0;
    },
    push(a, b, c, i = DEFAULT_BEAM_INTENSITY, w = DEFAULT_BEAM_WIDTH, f = 0) {
      const n = batch.dynamicCount;
      if (n >= capacity) {
        batch.overflow++;
        return;
      }
      const p = n * 6;
      dynamic.positions[p] = a.x;
      dynamic.positions[p + 1] = a.y;
      dynamic.positions[p + 2] = a.z;
      dynamic.positions[p + 3] = b.x;
      dynamic.positions[p + 4] = b.y;
      dynamic.positions[p + 5] = b.z;
      dynamic.color[n] = c;
      dynamic.intensity[n] = i;
      dynamic.width[n] = w;
      dynamic.flags[n] = f;
      batch.dynamicCount = n + 1;
    },
    endDynamic() {
      batch.frames++;
    },
    dispose() {
      batch.staticSet = null;
      batch.dynamicCount = 0;
    },
  };
  return batch;
}

export interface RecordingPointBatch extends PointBatch {
  staticSet: PointSet | null;
  readonly dynamic: Required<PointSet>;
  dynamicCount: number;
  overflow: number;
  frames: number;
}

export function createRecordingPointBatch(capacity = 1024): RecordingPointBatch {
  const dynamic = createPointSet(capacity, { size: true }) as Required<PointSet>;
  const batch: RecordingPointBatch = {
    capacity,
    staticSet: null,
    dynamic,
    dynamicCount: 0,
    overflow: 0,
    frames: 0,
    transform: new Matrix4(),
    visible: true,
    setStatic(set) {
      batch.staticSet = set;
    },
    beginDynamic() {
      batch.dynamicCount = 0;
      batch.overflow = 0;
    },
    push(p, c, i = 1, size = DEFAULT_POINT_SIZE) {
      const n = batch.dynamicCount;
      if (n >= capacity) {
        batch.overflow++;
        return;
      }
      dynamic.positions[n * 3] = p.x;
      dynamic.positions[n * 3 + 1] = p.y;
      dynamic.positions[n * 3 + 2] = p.z;
      dynamic.color[n] = c;
      dynamic.intensity[n] = i;
      dynamic.size[n] = size;
      batch.dynamicCount = n + 1;
    },
    endDynamic() {
      batch.frames++;
    },
    dispose() {
      batch.staticSet = null;
      batch.dynamicCount = 0;
    },
  };
  return batch;
}

export interface EventRecorder {
  readonly events: GameEvent[];
  ofType<T extends GameEventType>(type: T): EventOf<T>[];
  last<T extends GameEventType>(type: T): EventOf<T> | undefined;
  clear(): void;
  stop(): void;
}

export function recordEvents(bus: EventBus): EventRecorder {
  const events: GameEvent[] = [];
  const stop = bus.onAny((e) => events.push(e));
  const ofType = <T extends GameEventType>(type: T): EventOf<T>[] =>
    events.filter((e): e is EventOf<T> => e.type === type);
  return {
    events,
    ofType,
    last: (type) => ofType(type).at(-1),
    clear: () => {
      events.length = 0;
    },
    stop,
  };
}

export interface AudioCall {
  /** Dotted path, e.g. 'sfx', 'music.setState', 'phaseLock.setPlayer'. */
  method: string;
  args: unknown[];
}

export interface RecordingAudioEngine {
  engine: AudioEngine;
  calls: AudioCall[];
  callsTo(method: string): AudioCall[];
}

export function createRecordingAudioEngine(): RecordingAudioEngine {
  const noop = createNoopAudioEngine();
  const calls: AudioCall[] = [];
  const rec =
    <A extends unknown[], R>(method: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push({ method, args });
      return fn(...args);
    };

  const engine: AudioEngine = {
    unlock: rec('unlock', noop.unlock),
    sfx: rec('sfx', noop.sfx),
    music: {
      setState: rec('music.setState', noop.music.setState),
      setTempo: rec('music.setTempo', noop.music.setTempo),
      setKey: rec('music.setKey', noop.music.setKey),
    },
    motif: {
      attach: rec('motif.attach', noop.motif.attach),
      detach: rec('motif.detach', (h: Handle) => noop.motif.detach(h)),
    },
    phaseLock: {
      start: rec('phaseLock.start', noop.phaseLock.start),
      setTarget: rec('phaseLock.setTarget', noop.phaseLock.setTarget),
      setPlayer: rec('phaseLock.setPlayer', noop.phaseLock.setPlayer),
      stop: rec('phaseLock.stop', noop.phaseLock.stop),
    },
    modem: {
      start: rec('modem.start', noop.modem.start),
      stop: rec('modem.stop', noop.modem.stop),
    },
    duck: rec('duck', noop.duck),
    listener: rec('listener', noop.listener),
  };

  return { engine, calls, callsTo: (method) => calls.filter((c) => c.method === method) };
}
