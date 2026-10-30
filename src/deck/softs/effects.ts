import { clampLnR, wrapAngle, wrapPositive } from '../../breach/PhaseLock';
import type { IceModel, IceSoftMods } from '../../breach/IceModel';

/** Dropped DECOY lightpoint. M4.6 watchers chase this while `remaining` > 0. */
export interface DecoyLure {
  remaining: number;
  x: number;
  y: number;
  z: number;
  /** Engaged trace-gain multiplier while the lure is live. */
  traceMul: number;
}

/**
 * Tiny lure sink. Live watchers use `WatcherSim.dropLure` (§9.42); this stub
 * stores the lure so M4.4 labs/tests stay independent of the watcher field.
 */
export interface WatcherLureSink {
  setLure(lure: DecoyLure | null): void;
}

export interface WatcherLureStub extends WatcherLureSink {
  readonly lure: DecoyLure | null;
  readonly lured: boolean;
}

export function createWatcherLureStub(): WatcherLureStub {
  let lure: DecoyLure | null = null;
  return {
    get lure() {
      return lure;
    },
    get lured() {
      return lure !== null && lure.remaining > 0;
    },
    setLure(next) {
      lure = next;
    },
  };
}

export interface MimicKnobs {
  lnR: number;
  Phi: number;
}

/**
 * MIMIC: auto-converge ln R and Φ toward the layer target at `rate` units/s
 * (plan §3.5). Constant speed, shortest-arc on phase. Mutates `knobs` in place
 * — no allocation.
 */
export function stepMimicKnobs(
  knobs: MimicKnobs,
  targetLnR: number,
  targetPhi: number,
  rate: number,
  dt: number,
): void {
  if (!(rate > 0) || !(dt > 0)) return;
  const max = rate * dt;
  const dLn = targetLnR - knobs.lnR;
  if (dLn > max) knobs.lnR += max;
  else if (dLn < -max) knobs.lnR -= max;
  else knobs.lnR = targetLnR;
  knobs.lnR = clampLnR(knobs.lnR);

  const dPhi = wrapAngle(targetPhi - knobs.Phi);
  if (dPhi > max) knobs.Phi = wrapPositive(knobs.Phi + max);
  else if (dPhi < -max) knobs.Phi = wrapPositive(knobs.Phi - max);
  else knobs.Phi = wrapPositive(targetPhi);
}

export function applyMimicToIce(knobs: MimicKnobs, ice: IceModel, rate: number, dt: number): void {
  const cur = ice.state.current;
  const [a, b] = cur.ratio;
  stepMimicKnobs(knobs, Math.log(b / a), cur.phi - cur.roll, rate, dt);
}

export function applyClamp(ice: IceModel, delayRekey: number): void {
  ice.delayRekey(delayRekey);
}

export function applyKuang(ice: IceModel): void {
  ice.crack();
}

/** Idle ice-mod object. Registry copies fields into a reused `IceSoftMods`. */
export function idleIceMods(out: IceSoftMods): IceSoftMods {
  out.freezeDrift = false;
  out.feedbackMul = 1;
  out.traceMul = 1;
  return out;
}
