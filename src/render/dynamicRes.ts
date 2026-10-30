/**
 * Dynamic resolution (plan §8.7): if GPU frame time stays over 15 ms for 30
 * frames, step render scale down by 0.1 (min 0.6); step it back up when
 * headroom returns. Applied on top of `QualityConfig.baseScale`.
 *
 * `inject(ms)` is the test/debug hook: pretend every sample is `ms` until
 * cleared. That is the "artificial GPU load" the M0.4 AC asks for, and it
 * works in CI where SwiftShader has no timer query.
 */

export const DYNRES_DOWN_MS = 15;
export const DYNRES_UP_MS = 12;
export const DYNRES_STREAK = 30;
export const DYNRES_STEP = 0.1;
export const DYNRES_MIN = 0.6;
export const DYNRES_MAX = 1;

export interface DynamicRes {
  /** When false, `scale` is always 1 and samples are ignored. */
  enabled: boolean;
  /** Extra scale in [0.6, 1], 0.1 steps. */
  readonly scale: number;
  /** Consecutive frames in the current up/down direction. */
  readonly streak: number;
  /** Last sampled (or injected) GPU time in ms. */
  readonly lastMs: number | null;
  /**
   * Record one frame's GPU time. `null` is ignored unless `inject` is set,
   * so machines without a timer query (SwiftShader) don't drop scale from
   * CPU frame time. Returns true if `scale` changed.
   */
  sample(gpuMs: number | null): boolean;
  /** Sticky override used instead of `sample`'s argument. `null` clears it. */
  inject(gpuMs: number | null): void;
  reset(): void;
}

type Dir = 'up' | 'down' | 'hold';

const snap = (n: number): number => Math.round(n * 10) / 10;

export function createDynamicRes(): DynamicRes {
  let enabled = true;
  let scale = DYNRES_MAX;
  let streak = 0;
  let dir: Dir = 'hold';
  let lastMs: number | null = null;
  let injected: number | null = null;

  const apply = (ms: number): boolean => {
    lastMs = ms;
    if (!enabled) return false;

    let next: Dir = 'hold';
    if (ms > DYNRES_DOWN_MS) next = 'down';
    else if (ms < DYNRES_UP_MS) next = 'up';

    if (next === 'hold' || next !== dir) {
      dir = next;
      streak = next === 'hold' ? 0 : 1;
      return false;
    }
    streak++;
    if (streak < DYNRES_STREAK) return false;

    streak = 0;
    const stepped =
      dir === 'down'
        ? Math.max(DYNRES_MIN, snap(scale - DYNRES_STEP))
        : Math.min(DYNRES_MAX, snap(scale + DYNRES_STEP));
    if (stepped === scale) return false;
    scale = stepped;
    return true;
  };

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = value;
      if (!value) {
        scale = DYNRES_MAX;
        streak = 0;
        dir = 'hold';
      }
    },
    get scale() {
      return enabled ? scale : DYNRES_MAX;
    },
    get streak() {
      return streak;
    },
    get lastMs() {
      return lastMs;
    },
    sample(gpuMs) {
      const ms = injected ?? gpuMs;
      if (ms == null) return false;
      return apply(ms);
    },
    inject(gpuMs) {
      injected = gpuMs;
    },
    reset() {
      scale = DYNRES_MAX;
      streak = 0;
      dir = 'hold';
      lastMs = null;
      injected = null;
    },
  };
}
