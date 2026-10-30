import type { EventBus } from '../core/events';

/** Plan §3.6: regenerates 4/s when not engaged, after a 3 s delay. */
export const NEURAL_REGEN_PER_S = 4;
export const NEURAL_REGEN_DELAY = 3;
export const NEURAL_MAX = 100;
/** Each scar reduces max neural load by 5 (plan §3.6). */
export const SCAR_MAX_PENALTY = 5;
export const NEURAL_MIN_MAX = 5;

export function neuralMaxForScars(scars: number): number {
  const n = Math.max(0, scars | 0);
  return Math.max(NEURAL_MIN_MAX, NEURAL_MAX - n * SCAR_MAX_PENALTY);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface NeuralLoad {
  readonly value: number;
  readonly max: number;
  readonly scars: number;
  readonly time: number;
  readonly regenerating: boolean;
  /** True when value has reached the (scar-reduced) cap. */
  readonly flatlined: boolean;
  add(amount: number): void;
  set(value: number): void;
  setScars(n: number): void;
  addScar(): void;
  /**
   * Simulated clock. `engaged` suppresses regen (and keeps the delay armed
   * while dissonance can still raise the meter).
   */
  step(dt: number, engaged: boolean): void;
  reset(value?: number): void;
}

export interface NeuralLoadOptions {
  events?: EventBus;
  scars?: number;
  value?: number;
}

/**
 * Deck neural load (plan §3.6). Pure aside from optional `neuralChanged` posts
 * on integer crossings. The caller feeds a simulated `dt` — no wall clock.
 */
export function createNeuralLoad(opts: NeuralLoadOptions = {}): NeuralLoad {
  let scars = Math.max(0, opts.scars ?? 0);
  let max = neuralMaxForScars(scars);
  let value = clamp(opts.value ?? 0, 0, max);
  let t = 0;
  let lastRiseAt = 0;
  let posted = Math.round(value);

  const emit = (): void => {
    const n = Math.round(value);
    if (n === posted) return;
    posted = n;
    opts.events?.post({ type: 'neuralChanged', value: n });
  };

  const applyMax = (): void => {
    max = neuralMaxForScars(scars);
    if (value > max) value = max;
  };

  const api: NeuralLoad = {
    get value() {
      return value;
    },
    get max() {
      return max;
    },
    get scars() {
      return scars;
    },
    get time() {
      return t;
    },
    get regenerating() {
      return value > 0 && t - lastRiseAt >= NEURAL_REGEN_DELAY;
    },
    get flatlined() {
      return value >= max;
    },
    add(amount) {
      if (!(amount > 0)) {
        if (amount < 0) api.set(value + amount);
        return;
      }
      lastRiseAt = t;
      api.set(value + amount);
    },
    set(next) {
      const v = clamp(next, 0, max);
      if (v > value + 1e-9) lastRiseAt = t;
      value = v;
      emit();
    },
    setScars(n) {
      scars = Math.max(0, n | 0);
      applyMax();
      emit();
    },
    addScar() {
      api.setScars(scars + 1);
    },
    step(dt, engaged) {
      if (!(dt > 0)) return;
      const t0 = t;
      t += dt;
      if (engaged || value <= 0) return;
      const start = lastRiseAt + NEURAL_REGEN_DELAY;
      if (t <= start) return;
      const regenDt = t - Math.max(t0, start);
      if (regenDt > 0) api.set(value - NEURAL_REGEN_PER_S * regenDt);
    },
    reset(next = 0) {
      t = 0;
      lastRiseAt = 0;
      value = clamp(next, 0, max);
      posted = Math.round(value);
      opts.events?.post({ type: 'neuralChanged', value: posted });
    },
  };
  return api;
}
