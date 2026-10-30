import type { SaveStore } from '../core/save';
import { TRACE_HEAT_THRESHOLD } from './Trace';

/** Campaign heat 0–3 (plan §3.6). Later missions get +15% re-key per level. */
export const HEAT_MAX = 3;
export const HEAT_REKEY_PER_LEVEL = 0.15;

export interface Heat {
  readonly value: number;
  set(value: number): void;
  /** Ending a run with trace > 50% or getting burned raises heat by 1. */
  applyRunEnd(trace: number, burned: boolean): void;
  /** Lying low (skip an optional contract) drops heat by 1. */
  lieLow(): void;
  reset(): void;
}

export interface HeatOptions {
  save?: SaveStore;
  value?: number;
}

function clampHeat(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > HEAT_MAX ? HEAT_MAX : n;
}

/**
 * Campaign heat. Writes through to `save.data.campaign.heat` when a store is
 * provided so later missions can read it without owning the save schema.
 */
export function createHeat(opts: HeatOptions = {}): Heat {
  const read = (): number => clampHeat(opts.save?.data.campaign.heat ?? opts.value ?? 0);

  const write = (v: number): void => {
    const n = clampHeat(v);
    if (opts.save) {
      opts.save.data.campaign.heat = n;
      opts.save.commit();
    }
    opts.value = n;
  };

  if (opts.value !== undefined && opts.save) write(opts.value);

  const api: Heat = {
    get value() {
      return read();
    },
    set(v) {
      write(v);
    },
    applyRunEnd(trace, burned) {
      if (burned || trace > TRACE_HEAT_THRESHOLD) write(read() + 1);
    },
    lieLow() {
      write(read() - 1);
    },
    reset() {
      write(0);
    },
  };
  return api;
}
