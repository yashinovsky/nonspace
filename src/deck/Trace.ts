import type { EventBus } from '../core/events';

/** Plan §3.6 / §12.3: 0–100%. At 100 the deck forces a jack-out (burned). */
export const TRACE_MAX = 100;
/** Heat ticks if a run ends with trace above this (plan §3.6). */
export const TRACE_HEAT_THRESHOLD = 50;
/** Hull contact while not engaged (plan §3.3 / §12.3 TRACE_RATES.hullContact). %/s. */
export const HULL_TRACE_RATE = 2;
/** Route-out scrubs this fraction (plan §3.2). M4.5 owns the fly-out. */
export const ROUTE_OUT_TRACE_SCRUB = 0.3;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface Trace {
  readonly value: number;
  readonly burned: boolean;
  add(amount: number): void;
  set(value: number): void;
  /** Rise at `rate` %/s (ICE `traceRate`, hull contact, watchers). */
  step(dt: number, rate: number): void;
  /** Multiply remaining trace (DECOY, route-out). */
  scrub(fraction: number): void;
  reset(value?: number): void;
}

export interface TraceOptions {
  events?: EventBus;
  value?: number;
}

/**
 * Deck trace meter (plan §3.6). Posts `traceChanged` on integer crossings so
 * the HUD bargraph and the trace-tick SFX do not fire every sim step.
 */
export function createTrace(opts: TraceOptions = {}): Trace {
  let value = clamp(opts.value ?? 0, 0, TRACE_MAX);
  let posted = Math.round(value);

  const emit = (): void => {
    const n = Math.round(value);
    if (n === posted) return;
    posted = n;
    opts.events?.post({ type: 'traceChanged', value: n });
  };

  const api: Trace = {
    get value() {
      return value;
    },
    get burned() {
      return value >= TRACE_MAX;
    },
    add(amount) {
      if (!amount) return;
      api.set(value + amount);
    },
    set(next) {
      value = clamp(next, 0, TRACE_MAX);
      emit();
    },
    step(dt, rate) {
      if (!(dt > 0) || !(rate > 0)) return;
      api.set(value + rate * dt);
    },
    scrub(fraction) {
      const f = clamp(fraction, 0, 1);
      api.set(value * (1 - f));
    },
    reset(next = 0) {
      value = clamp(next, 0, TRACE_MAX);
      posted = Math.round(value);
      opts.events?.post({ type: 'traceChanged', value: posted });
    },
  };
  return api;
}
