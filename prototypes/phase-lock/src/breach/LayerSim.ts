import {
  DISSONANCE_THRESHOLD,
  LOCK_THRESHOLD,
  type Ratio,
  TAU,
  matchMetric,
  rekeyMeterReset,
  stepLockMeter,
  stepRoll,
  wrapPositive,
} from './PhaseLock';
import type { IceLayerDef } from './presets';
import { Rng } from './rng';

/**
 * One ICE layer engagement: drift, telegraphed re-keys, lock meter, trace, neural load, grip.
 * Pure and deterministic for a given seed and input stream (no clock, no DOM).
 * In the full game this splits into `breach/IceModel.ts` (M4.2) and `BreachController`/`Grip` (M4.3).
 */

export type LayerStatus = 'engaged' | 'cracked' | 'flatline' | 'burned';

export interface Telegraph {
  start: number;
  end: number;
  next: Ratio;
  /** Added to the drifting phase at re-key time, so a preview of the incoming figure stays exact. */
  phaseJump: number;
  ratioChanged: boolean;
}

export type LayerEvent =
  | { type: 'telegraph'; telegraph: Telegraph }
  | { type: 'rekey'; ratioChanged: boolean; meterBefore: number; meterAfter: number }
  | { type: 'lockStep'; step: number }
  | { type: 'crack' }
  | { type: 'grip'; reason: 'neural' | 'rekey' }
  | { type: 'flatline' }
  | { type: 'burned' };

export interface LayerStats {
  rekeys: number;
  /** Re-keys that cost meter progress. */
  setbacks: number;
  /** Total meter fraction lost to re-keys. */
  lostProgress: number;
  /** Seconds spent at m ≥ 0.85. */
  timeLocked: number;
  /** Seconds spent at m < 0.3. */
  timeDissonant: number;
}

export interface LayerState {
  t: number;
  ratio: Ratio;
  phi: number;
  /** Breaker roll; the visible breaker phase is Phi + roll. */
  roll: number;
  meter: number;
  m: number;
  trace: number;
  neural: number;
  status: LayerStatus;
  telegraph: Telegraph | null;
  nextRekeyAt: number | null;
  grip: { start: number; deadline: number; reason: 'neural' | 'rekey' } | null;
  stats: LayerStats;
}

/** Probability that a re-key changes the ratio (otherwise it only jumps the phase). */
export const REKEY_RATIO_CHANGE_P = 0.65;

export class LayerSim {
  readonly def: IceLayerDef;
  readonly state: LayerState;
  private readonly rng: Rng;
  private driftDir: number;
  private nextDriftFlip: number;

  constructor(def: IceLayerDef, seed: number, opts: { trace?: number; neural?: number } = {}) {
    this.def = def;
    this.rng = new Rng(seed);
    this.driftDir = this.rng.next() < 0.5 ? -1 : 1;
    this.nextDriftFlip = this.rng.range(2, 5);
    this.state = {
      t: 0,
      ratio: this.rng.pick(def.ratios),
      phi: this.rng.range(0, TAU),
      roll: 0,
      meter: 0,
      m: 0,
      trace: opts.trace ?? 0,
      neural: opts.neural ?? 0,
      status: 'engaged',
      telegraph: null,
      nextRekeyAt: def.rekeyEvery ? this.rng.range(def.rekeyEvery[0], def.rekeyEvery[1]) : null,
      grip: null,
      stats: { rekeys: 0, setbacks: 0, lostProgress: 0, timeLocked: 0, timeDissonant: 0 },
    };
  }

  /** Advance by dt seconds with the breaker knobs at (R, Phi). Returns events fired this step. */
  step(dt: number, R: number, Phi: number): LayerEvent[] {
    const s = this.state;
    const d = this.def;
    const ev: LayerEvent[] = [];
    if (s.status !== 'engaged') return ev;

    s.t += dt;

    if (s.t >= this.nextDriftFlip) {
      this.driftDir = -this.driftDir;
      this.nextDriftFlip = s.t + this.rng.range(2, 5);
    }
    s.phi = wrapPositive(s.phi + this.driftDir * d.phaseDrift * dt);

    if (s.nextRekeyAt !== null && !s.telegraph && s.t >= s.nextRekeyAt - d.telegraph) {
      s.telegraph = this.planRekey(s.nextRekeyAt);
      ev.push({ type: 'telegraph', telegraph: s.telegraph });
    }

    if (s.telegraph && s.t >= s.telegraph.end) {
      const tg = s.telegraph;
      const before = s.meter;
      s.ratio = tg.next;
      s.phi = wrapPositive(s.phi + tg.phaseJump);
      s.meter = rekeyMeterReset(before);
      s.telegraph = null;
      s.stats.rekeys++;
      if (s.meter < before) {
        s.stats.setbacks++;
        s.stats.lostProgress += before - s.meter;
      }
      s.nextRekeyAt = d.rekeyEvery ? s.t + this.rng.range(d.rekeyEvery[0], d.rekeyEvery[1]) : null;
      ev.push({ type: 'rekey', ratioChanged: tg.ratioChanged, meterBefore: before, meterAfter: s.meter });
      if (d.grip && !s.grip && before < 0.3 && s.t >= (d.grip.rekeyGraceS ?? 0)) this.startGrip('rekey', ev);
    }

    const [a, b] = s.ratio;
    s.roll = stepRoll(s.roll, R, a, b, dt);
    s.m = matchMetric(R, Phi + s.roll, a, b, s.phi, d.tolRatio);

    const prevStep = Math.floor(s.meter * 10);
    s.meter = stepLockMeter(s.meter, s.m, dt, d.lockTime);
    const step = Math.floor(s.meter * 10);
    if (step > prevStep && step < 10) ev.push({ type: 'lockStep', step });
    if (s.m >= LOCK_THRESHOLD) s.stats.timeLocked += dt;

    if (s.meter >= 1) {
      s.status = 'cracked';
      s.grip = null;
      ev.push({ type: 'crack' });
      return ev;
    }

    s.trace += d.traceRate * dt;
    if (s.trace >= 100) {
      s.trace = 100;
      s.status = 'burned';
      ev.push({ type: 'burned' });
      return ev;
    }

    if (s.m < DISSONANCE_THRESHOLD) {
      s.neural += d.feedbackDps * dt;
      s.stats.timeDissonant += dt;
    }
    if (d.grip && !s.grip && s.neural > d.grip.neuralThreshold) this.startGrip('neural', ev);
    if (s.neural >= 100 || (s.grip && s.t >= s.grip.deadline)) {
      s.neural = Math.min(100, s.neural);
      s.status = 'flatline';
      ev.push({ type: 'flatline' });
    }
    return ev;
  }

  private planRekey(at: number): Telegraph {
    const s = this.state;
    const others = this.def.ratios.filter((r) => r[0] !== s.ratio[0] || r[1] !== s.ratio[1]);
    const ratioChanged = others.length > 0 && this.rng.next() < REKEY_RATIO_CHANGE_P;
    const next = ratioChanged ? this.rng.pick(others) : s.ratio;
    const phaseJump = ratioChanged
      ? this.rng.range(0, TAU)
      : (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(Math.PI / 2, (3 * Math.PI) / 2);
    return { start: at - this.def.telegraph, end: at, next, phaseJump, ratioChanged };
  }

  private startGrip(reason: 'neural' | 'rekey', ev: LayerEvent[]): void {
    const s = this.state;
    const g = this.def.grip!;
    s.grip = { start: s.t, deadline: s.t + g.seconds, reason };
    if (!g.keepRekeying) {
      // The ICE has hold of you: no more re-keys, just the countdown.
      s.telegraph = null;
      s.nextRekeyAt = null;
    }
    ev.push({ type: 'grip', reason });
  }
}
