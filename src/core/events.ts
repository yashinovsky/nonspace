import type { NeuromancerAction } from '../ai/Neuromancer';
import type { WintermuteAction } from '../ai/Wintermute';
import type { ModeId } from '../app/ModeStack';
import type { Vec3 } from './math/vec3';

/**
 * Game events (plan §9.1). `gripStart`/`gripEnd` are separate members (the plan
 * writes them as one member with a union `type`) so `EventOf<'gripStart'>`
 * resolves; the shapes are identical.
 */
export type GameEvent =
  | { type: 'jackIn'; missionId: string }
  | { type: 'jackOut'; reason: 'player' | 'burned' | 'script' }
  | { type: 'flatline'; scripted: boolean }
  | { type: 'modeChanged'; from: ModeId; to: ModeId }
  | { type: 'scanPulse'; origin: Vec3 }
  | { type: 'iceEngaged'; iceId: string; layer: number }
  | { type: 'iceRekeyTelegraph'; iceId: string; inSeconds: number }
  | { type: 'iceRekey'; iceId: string }
  | { type: 'iceLayerCracked'; iceId: string; layer: number }
  | { type: 'gripStart'; iceId: string }
  | { type: 'gripEnd'; iceId: string }
  | { type: 'traceChanged'; value: number }
  | { type: 'neuralChanged'; value: number }
  | { type: 'downloadProgress'; targetId: string; value: number }
  | { type: 'simstimFlip'; on: boolean }
  | { type: 'gateWindow'; gateId: string; state: 'open' | 'hit' | 'early' | 'late' | 'missed' }
  | { type: 'mollyPain'; amount: number }
  | { type: 'softUsed'; softId: string }
  | { type: 'dixieSay'; lineId: string }
  | { type: 'wintermute'; action: WintermuteAction }
  | { type: 'neuromancer'; action: NeuromancerAction }
  | { type: 'objective'; id: string; state: 'active' | 'done' | 'failed' };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type Listener<T extends GameEventType> = (event: EventOf<T>) => void;
export type AnyListener = (event: GameEvent) => void;
export type Unsubscribe = () => void;

// A Record keyed by the union makes the compiler reject missing or extra types.
const EVENT_TYPE_TABLE: Record<GameEventType, true> = {
  jackIn: true,
  jackOut: true,
  flatline: true,
  modeChanged: true,
  scanPulse: true,
  iceEngaged: true,
  iceRekeyTelegraph: true,
  iceRekey: true,
  iceLayerCracked: true,
  gripStart: true,
  gripEnd: true,
  traceChanged: true,
  neuralChanged: true,
  downloadProgress: true,
  simstimFlip: true,
  gateWindow: true,
  mollyPain: true,
  softUsed: true,
  dixieSay: true,
  wintermute: true,
  neuromancer: true,
  objective: true,
};

export const GAME_EVENT_TYPES = Object.freeze(Object.keys(EVENT_TYPE_TABLE)) as readonly [
  GameEventType,
  ...GameEventType[],
];

export function isGameEventType(value: string): value is GameEventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPE_TABLE, value);
}

/**
 * Synchronous typed event bus. Dispatch does not allocate. Listeners added
 * during a dispatch do not receive the event being dispatched; listeners
 * removed during a dispatch are skipped. If listeners throw, the remaining
 * listeners still run and the first error is rethrown after dispatch.
 */
export interface EventBus {
  on<T extends GameEventType>(type: T, listener: Listener<T>): Unsubscribe;
  /** Remove with the returned function; `off(type, listener)` does not match once-wrappers. */
  once<T extends GameEventType>(type: T, listener: Listener<T>): Unsubscribe;
  off<T extends GameEventType>(type: T, listener: Listener<T>): void;
  onAny(listener: AnyListener): Unsubscribe;
  offAny(listener: AnyListener): void;
  emit(event: GameEvent): void;
  /**
   * Queue an event for the next `flush()`. Sim code posts during a step and the
   * loop flushes once per step, so listeners always run at the same point.
   */
  post(event: GameEvent): void;
  /**
   * Emit queued events in order, including ones posted by listeners during the
   * flush. A nested `flush()` is a no-op. Listener errors don't stop the drain;
   * the first one is rethrown at the end.
   */
  flush(): void;
  pendingCount(): number;
  listenerCount(type?: GameEventType): number;
  /** Remove all listeners and drop queued events. */
  clear(): void;
}

/** A flush that keeps re-posting more than this many events is a feedback loop. */
export const MAX_EVENTS_PER_FLUSH = 10_000;

type Slot = AnyListener | null;

export function createEventBus(): EventBus {
  const byType = new Map<GameEventType, Slot[]>();
  const any: Slot[] = [];
  const queue: GameEvent[] = [];
  let depth = 0;
  let dirty = false;
  let flushing = false;

  const listFor = (type: GameEventType): Slot[] => {
    let list = byType.get(type);
    if (!list) {
      list = [];
      byType.set(type, list);
    }
    return list;
  };

  const remove = (list: Slot[] | undefined, fn: AnyListener): void => {
    if (!list) return;
    const i = list.indexOf(fn);
    if (i < 0) return;
    if (depth > 0) {
      list[i] = null;
      dirty = true;
    } else {
      list.splice(i, 1);
    }
  };

  const compact = (list: Slot[]): void => {
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const fn = list[r];
      if (fn) list[w++] = fn;
    }
    list.length = w;
  };

  const count = (list: Slot[] | undefined): number => {
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i]) n++;
    return n;
  };

  const bus: EventBus = {
    on(type, listener) {
      const fn = listener as AnyListener;
      listFor(type).push(fn);
      return () => remove(byType.get(type), fn);
    },
    once(type, listener) {
      const wrapper: AnyListener = (event) => {
        unsubscribe();
        (listener as AnyListener)(event);
      };
      listFor(type).push(wrapper);
      const unsubscribe = (): void => remove(byType.get(type), wrapper);
      return unsubscribe;
    },
    off(type, listener) {
      remove(byType.get(type), listener as AnyListener);
    },
    onAny(listener) {
      any.push(listener);
      return () => remove(any, listener);
    },
    offAny(listener) {
      remove(any, listener);
    },
    emit(event) {
      const list = byType.get(event.type);
      let error: unknown = undefined;
      let failed = false;
      depth++;
      try {
        if (list) {
          for (let i = 0, n = list.length; i < n; i++) {
            const fn = list[i];
            if (!fn) continue;
            try {
              fn(event);
            } catch (err) {
              if (!failed) {
                failed = true;
                error = err;
              }
            }
          }
        }
        for (let i = 0, n = any.length; i < n; i++) {
          const fn = any[i];
          if (!fn) continue;
          try {
            fn(event);
          } catch (err) {
            if (!failed) {
              failed = true;
              error = err;
            }
          }
        }
      } finally {
        depth--;
        if (depth === 0 && dirty) {
          dirty = false;
          for (const l of byType.values()) compact(l);
          compact(any);
        }
      }
      if (failed) throw error;
    },
    post(event) {
      queue.push(event);
    },
    flush() {
      if (flushing) return;
      flushing = true;
      let error: unknown = undefined;
      let failed = false;
      try {
        for (let i = 0; i < queue.length; i++) {
          if (i >= MAX_EVENTS_PER_FLUSH) {
            throw new Error(
              `event flush exceeded ${MAX_EVENTS_PER_FLUSH} events; a listener is re-posting in a loop`,
            );
          }
          try {
            bus.emit(queue[i]!);
          } catch (err) {
            if (!failed) {
              failed = true;
              error = err;
            }
          }
        }
      } finally {
        queue.length = 0;
        flushing = false;
      }
      if (failed) throw error;
    },
    pendingCount() {
      return queue.length;
    },
    listenerCount(type) {
      if (type) return count(byType.get(type));
      let n = count(any);
      for (const l of byType.values()) n += count(l);
      return n;
    },
    clear() {
      queue.length = 0;
      if (depth > 0) {
        for (const l of byType.values()) l.fill(null);
        any.fill(null);
        dirty = true;
      } else {
        byType.clear();
        any.length = 0;
      }
    },
  };
  return bus;
}
