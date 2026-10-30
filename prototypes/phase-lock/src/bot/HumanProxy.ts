import { type LayerSim, type Telegraph } from '../breach/LayerSim';
import {
  LN_RATIO_MAX,
  LN_RATIO_MIN,
  type Ratio,
  SCOPE_HZ,
  knobToR,
  phaseError,
  rollRate,
  wrapPositive,
} from '../breach/PhaseLock';
import { Rng } from '../breach/rng';

/**
 * A scripted stand-in for a human player, used for self-tests and the attract/demo mode.
 * It only reads what is on screen (figures, telegraph ghost, meter) through a reaction delay,
 * and is limited by recognition time, ratio confusion, knob speed, aim error and phase noise.
 * The numbers are assumptions, not measurements; see PLAYTEST.md.
 */
export interface BotProfile {
  name: string;
  /** s between something appearing on screen and the hand responding */
  reaction: number;
  /** s to recognise a figure's ratio: idBase + idPerLobe·(a+b) */
  idBase: number;
  idPerLobe: number;
  /** chance per lobe above 3 of mistaking the ratio for a neighbouring one */
  confuse: number;
  /** s to notice the chosen ratio is wrong */
  realize: [number, number];
  /** max knob speed, ln units/s */
  slew: number;
  /** σ of the landing error after a ratio move, ln units */
  aimSigma: number;
  /** s per fine ratio correction */
  trimStep: [number, number];
  /** fraction of ratio error left after a correction */
  trimResidual: number;
  /** smallest roll (figure cycles/s) the player notices */
  rollPerceive: number;
  phaseGain: number;
  phaseMaxRate: number;
  /** σ of phase misjudgement, rad (resampled every 0.3 s) */
  phaseNoise: number;
  /** σ of hand jitter, rad/s */
  motorNoise: number;
  /** reads the ghost preview of the incoming figure during telegraphs */
  useTelegraph: boolean;
}

export const BOT_PROFILES: Record<'novice' | 'average' | 'skilled', BotProfile> = {
  novice: {
    name: 'novice',
    reaction: 0.3,
    idBase: 0.5,
    idPerLobe: 0.18,
    confuse: 0.06,
    realize: [0.8, 1.6],
    slew: 2.0,
    aimSigma: 0.045,
    trimStep: [0.35, 0.7],
    trimResidual: 0.45,
    rollPerceive: 0.06,
    phaseGain: 2.5,
    phaseMaxRate: 3,
    phaseNoise: 0.18,
    motorNoise: 0.6,
    useTelegraph: true,
  },
  average: {
    name: 'average',
    reaction: 0.24,
    idBase: 0.4,
    idPerLobe: 0.12,
    confuse: 0.04,
    realize: [0.6, 1.2],
    slew: 3.0,
    aimSigma: 0.03,
    trimStep: [0.25, 0.5],
    trimResidual: 0.35,
    rollPerceive: 0.045,
    phaseGain: 3.5,
    phaseMaxRate: 4.5,
    phaseNoise: 0.12,
    motorNoise: 0.4,
    useTelegraph: true,
  },
  skilled: {
    name: 'skilled',
    reaction: 0.19,
    idBase: 0.3,
    idPerLobe: 0.07,
    confuse: 0.02,
    realize: [0.4, 0.8],
    slew: 4.0,
    aimSigma: 0.018,
    trimStep: [0.18, 0.35],
    trimResidual: 0.25,
    rollPerceive: 0.03,
    phaseGain: 5,
    phaseMaxRate: 6,
    phaseNoise: 0.08,
    motorNoise: 0.25,
    useTelegraph: true,
  },
};

interface Snapshot {
  ratio: Ratio;
  phi: number;
  /** breaker phase as drawn (knob + roll) */
  shown: number;
  meter: number;
  telegraph: Telegraph | null;
}

type Mode = 'identify' | 'aim' | 'settle';

const key = (r: Ratio) => `${r[0]}:${r[1]}`;

export class HumanProxy {
  readonly profile: BotProfile;
  /** Raw ratio knob position (ln R before detents). */
  u: number;
  Phi: number;
  purist = false;

  private readonly rng: Rng;
  private readonly ratios: readonly Ratio[];
  private hist: Snapshot[] = [];
  private seen = '';
  private mode: Mode = 'identify';
  private timer = 0;
  private believed: Ratio = [1, 1];
  private aimTarget = 0;
  private wrongTimer = 0;
  private trimTimer = 0;
  private stuckTimer = 0;
  private lastMeter = 0;
  private noise = 0;
  private noiseTimer = 0;
  private pre: { key: string; timer: number; believed: Ratio } | null = null;
  private retry = false;

  constructor(profile: BotProfile, ratios: readonly Ratio[], seed: number, start?: { u: number; Phi: number }) {
    this.profile = profile;
    this.ratios = ratios;
    this.rng = new Rng(seed);
    this.u = start?.u ?? this.rng.range(Math.log(0.5), Math.log(2));
    this.Phi = start?.Phi ?? this.rng.range(0, Math.PI * 2);
  }

  get R(): number {
    return knobToR(this.u, this.purist);
  }

  /** Read the (delayed) screen and move the knobs for one step. Call before `sim.step`. */
  step(dt: number, sim: LayerSim): void {
    const p = this.profile;
    const s = sim.state;
    this.hist.push({ ratio: s.ratio, phi: s.phi, shown: this.Phi + s.roll, meter: s.meter, telegraph: s.telegraph });
    const lag = Math.round(p.reaction / dt);
    if (this.hist.length > lag + 1) this.hist.shift();
    const view = this.hist[0];

    const k = key(view.ratio);
    if (k !== this.seen) {
      const first = this.seen === '';
      this.seen = k;
      if (this.pre && this.pre.key === k && this.pre.timer <= 0) {
        this.believed = this.pre.believed;
        this.startAim();
      } else if (!first && this.mode === 'settle' && key(this.believed) === k) {
        // Same figure after a phase-only jump: keep tracking.
      } else {
        this.mode = 'identify';
        this.timer = this.idTime(view.ratio);
        this.retry = false;
      }
      this.pre = null;
    }

    if (p.useTelegraph && view.telegraph && !this.pre && key(view.telegraph.next) !== k) {
      const next = view.telegraph.next;
      this.pre = { key: key(next), timer: this.idTime(next), believed: this.maybeConfuse(next) };
    }
    if (this.pre) this.pre.timer -= dt;

    const [a, b] = view.ratio;
    switch (this.mode) {
      case 'identify':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.believed = this.retry ? view.ratio : this.maybeConfuse(view.ratio);
          this.startAim();
        }
        break;
      case 'aim': {
        const d = this.aimTarget - this.u;
        const stepMax = p.slew * dt;
        if (Math.abs(d) <= stepMax) {
          this.u = this.aimTarget;
          this.mode = 'settle';
          this.trimTimer = this.rng.range(p.trimStep[0], p.trimStep[1]);
          this.wrongTimer = this.rng.range(p.realize[0], p.realize[1]);
          this.stuckTimer = 0;
        } else {
          this.u += Math.sign(d) * stepMax;
        }
        break;
      }
      case 'settle': {
        if (key(this.believed) !== k) {
          this.wrongTimer -= dt;
          if (this.wrongTimer <= 0) {
            this.mode = 'identify';
            this.timer = this.idTime(view.ratio) * 0.6;
            this.retry = true;
          }
          break;
        }
        const roll = Math.abs(rollRate(this.R, a, b, SCOPE_HZ));
        const progressing = view.meter > this.lastMeter + 1e-6;
        this.stuckTimer = progressing ? 0 : this.stuckTimer + dt;
        if (roll > p.rollPerceive || this.stuckTimer > 0.8) {
          this.trimTimer -= dt;
          if (this.trimTimer <= 0) {
            const err = Math.log(this.R) - Math.log(b / a);
            const left = err * p.trimResidual * Math.abs(1 + 0.5 * this.rng.gauss());
            this.u = this.clampU(this.u - err + (this.rng.next() < 0.5 ? -left : left));
            this.trimTimer = this.rng.range(p.trimStep[0], p.trimStep[1]);
            this.stuckTimer = 0;
          }
        }
        if (roll <= p.rollPerceive * 3) this.trackPhase(dt, view, a, b);
        break;
      }
    }
    this.lastMeter = view.meter;
  }

  private trackPhase(dt: number, view: Snapshot, a: number, b: number): void {
    const p = this.profile;
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noise = this.rng.gauss() * p.phaseNoise;
      this.noiseTimer = 0.3;
    }
    const e = phaseError(view.shown, view.phi + this.noise, a, b);
    let rate = -p.phaseGain * e;
    if (rate > p.phaseMaxRate) rate = p.phaseMaxRate;
    else if (rate < -p.phaseMaxRate) rate = -p.phaseMaxRate;
    rate += this.rng.gauss() * p.motorNoise;
    this.Phi = wrapPositive(this.Phi + rate * dt);
  }

  private startAim(): void {
    this.mode = 'aim';
    this.aimTarget = this.clampU(Math.log(this.believed[1] / this.believed[0]) + this.rng.gauss() * this.profile.aimSigma);
  }

  private idTime([a, b]: Ratio): number {
    const p = this.profile;
    return (p.idBase + p.idPerLobe * (a + b)) * Math.exp(0.25 * this.rng.gauss());
  }

  private maybeConfuse(r: Ratio): Ratio {
    const lobes = r[0] + r[1];
    const pConf = this.profile.confuse * Math.max(0, lobes - 3);
    if (this.rng.next() >= pConf) return r;
    const sorted = [...this.ratios].sort((x, y) => x[1] / x[0] - y[1] / y[0]);
    const i = sorted.findIndex((x) => key(x) === key(r));
    const n = sorted.filter((_, j) => Math.abs(j - i) === 1);
    return n.length ? this.rng.pick(n) : r;
  }

  private clampU(u: number): number {
    return u < LN_RATIO_MIN ? LN_RATIO_MIN : u > LN_RATIO_MAX ? LN_RATIO_MAX : u;
  }
}
