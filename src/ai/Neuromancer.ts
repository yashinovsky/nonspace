import type { Vec3 } from '../core/math/vec3';
import type { FlightController } from '../player/FlightController';
import { setBeamSoften, subdivideLineSet, type LineSet } from '../render/lines/BeamBatch';
import type { Palette } from '../render/palette';

/**
 * Neuromancer behaviors from plan §3.8. `soften` amount 0 restores palette
 * warmth and beam template with no leftover state.
 */
export type NeuromancerAction =
  | { kind: 'soften'; amount: number }
  | { kind: 'pull'; target: Vec3 | null; strength: number }
  | { kind: 'beach' };

export const SOFTEN_SUBDIVISIONS = 8;

export function softenLineSet(set: LineSet, amount: number): LineSet {
  if (!(amount > 1e-4)) return set;
  return subdivideLineSet(set, SOFTEN_SUBDIVISIONS);
}

export interface NeuromancerHost {
  palette: Palette;
  flight?: FlightController;
  forceBeach?: () => void;
}

export interface Neuromancer {
  apply(action: NeuromancerAction): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  readonly soften: number;
  readonly pullStrength: number;
  readonly jackOutBlocked: boolean;
  readonly beachQueued: boolean;
}

export function createNeuromancer(host: NeuromancerHost): Neuromancer {
  let soften = 0;
  let pullStrength = 0;
  let beachQueued = false;
  let time = 0;

  const applySoften = (amount: number): void => {
    const t = Math.min(1, Math.max(0, amount));
    soften = t;
    host.palette.addWarmth(t);
    setBeamSoften(t, time);
  };

  const api: Neuromancer = {
    get soften() {
      return soften;
    },
    get pullStrength() {
      return pullStrength;
    },
    get jackOutBlocked() {
      return host.flight?.jackOutBlocked ?? pullStrength > 0;
    },
    get beachQueued() {
      return beachQueued;
    },
    apply(action) {
      switch (action.kind) {
        case 'soften':
          applySoften(action.amount);
          break;
        case 'pull':
          pullStrength = action.target && action.strength > 0 ? action.strength : 0;
          host.flight?.setPull(action.target, pullStrength);
          break;
        case 'beach':
          beachQueued = true;
          host.forceBeach?.();
          break;
      }
    },
    update(dt) {
      time += Math.max(0, dt);
      if (soften > 0) setBeamSoften(soften, time);
    },
    reset() {
      applySoften(0);
      pullStrength = 0;
      host.flight?.setPull(null, 0);
      beachQueued = false;
      time = 0;
    },
    dispose() {
      api.reset();
    },
  };
  return api;
}
