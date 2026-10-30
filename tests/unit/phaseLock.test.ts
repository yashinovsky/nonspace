import { describe, expect, it } from 'vitest';
import {
  DETENTS_LN,
  DETENT_WIDTH,
  LOCK_THRESHOLD,
  SCOPE_HZ,
  TAU,
  applyDetent,
  beatHz,
  knobToR,
  matchMetric,
  phaseError,
  phaseMatch,
  ratioMatch,
  rekeyMeterReset,
  reversedPhase,
  rollRate,
  sampleBreaker,
  sampleTarget,
  stepLockMeter,
  stepRoll,
  wrapAngle,
} from '../../src/breach/PhaseLock';

/** Symmetric mean nearest-point distance between two sampled figures (shape comparison). */
function shapeDistance(
  a: { x: Float32Array; y: Float32Array },
  b: { x: Float32Array; y: Float32Array },
): number {
  const one = (p: typeof a, q: typeof a) => {
    let sum = 0;
    for (let i = 0; i < p.x.length; i += 3) {
      let best = Infinity;
      for (let j = 0; j < q.x.length; j++) {
        const d = (p.x[i] - q.x[j]) ** 2 + (p.y[i] - q.y[j]) ** 2;
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return sum / Math.ceil(p.x.length / 3);
  };
  return (one(a, b) + one(b, a)) / 2;
}

describe('match metric (plan §3.5)', () => {
  it('is 1 at an exact ratio and phase match', () => {
    expect(matchMetric(3 / 2, 0.7, 2, 3, 0.7, 0.06)).toBeCloseTo(1, 12);
  });

  it('drops below the lock threshold quickly off-ratio', () => {
    expect(matchMetric(1.6, 0, 2, 3, 0, 0.06)).toBeLessThan(LOCK_THRESHOLD);
  });

  it('scores the observed phase: a near-miss ratio rolls the breaker out of lock', () => {
    const [a, b] = [2, 3];
    const tol = 0.06;
    const R = 1.5 * Math.exp(0.004); // well inside tolerance on ratio alone
    const knob = 0.7;
    let roll = 0;
    for (let i = 0; i < 120 * 6; i++) roll = stepRoll(roll, R, a, b, 1 / 120);
    expect(matchMetric(R, knob, a, b, knob, tol)).toBeGreaterThan(LOCK_THRESHOLD);
    expect(matchMetric(R, knob + roll, a, b, knob, tol)).toBeLessThan(LOCK_THRESHOLD);
  });

  it('follows mR = exp(-(ratioErr/tol)^2)', () => {
    const tol = 0.06;
    expect(ratioMatch((3 / 2) * Math.exp(tol), 2, 3, tol)).toBeCloseTo(Math.exp(-1), 12);
    expect(ratioMatch((3 / 2) * Math.exp(-2 * tol), 2, 3, tol)).toBeCloseTo(Math.exp(-4), 12);
  });

  it('follows mP = (0.5 + 0.5 cos(Φ − φ))^4 and m = mR·mP', () => {
    // For 2:3 at φ = 0 the reversed twin sits at π, so errors below π/2 are measured from φ itself.
    for (const d of [0.1, 0.4, 1, 1.5, -1.2]) {
      const mP = (0.5 + 0.5 * Math.cos(d)) ** 4;
      expect(phaseMatch(d, 0, 2, 3)).toBeCloseTo(mP, 12);
      const R = 1.5 * Math.exp(0.03);
      expect(matchMetric(R, d, 2, 3, 0, 0.06)).toBeCloseTo(ratioMatch(R, 2, 3, 0.06) * mP, 12);
    }
  });

  it('bottoms out halfway between the twins and wraps around 2π', () => {
    expect(matchMetric(2, Math.PI / 2, 1, 2, 0, 0.1)).toBeCloseTo(1 / 16, 12);
    expect(matchMetric(2, Math.PI, 1, 2, 0, 0.1)).toBeCloseTo(1, 12);
    expect(matchMetric(2, TAU + 0.3, 1, 2, 0.3, 0.1)).toBeCloseTo(1, 12);
  });

  it('folds the time-reversed twin phase, which draws the identical picture', () => {
    for (const [a, b] of [
      [1, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 5],
      [4, 5],
      [5, 6],
    ]) {
      const phi = 0.9;
      const twin = reversedPhase(phi, a, b);
      expect(
        shapeDistance(sampleTarget(a, b, phi, 0, 900), sampleTarget(a, b, twin, 0, 900)),
      ).toBeLessThan(0.01);
      expect(phaseMatch(twin, phi, a, b)).toBeCloseTo(1, 12);
    }
    // −φ is the twin only when a and b are both odd; for 2:3 it is a different picture and scores low.
    expect(reversedPhase(0.9, 3, 5)).toBeCloseTo(TAU - 0.9, 12);
    expect(
      shapeDistance(sampleTarget(2, 3, 0.9, 0, 900), sampleTarget(2, 3, -0.9, 0, 900)),
    ).toBeGreaterThan(0.03);
    expect(phaseMatch(-0.9, 0.9, 2, 3)).toBeLessThan(0.5);
  });

  it('uses a figure phase: away from the twin, different φ draw different pictures (no 2π/b aliasing)', () => {
    const base = sampleTarget(2, 3, 0.5, 0, 900);
    expect(shapeDistance(base, sampleTarget(2, 3, 0.5 + 1, 0, 900))).toBeGreaterThan(0.08);
    expect(shapeDistance(base, sampleTarget(2, 3, 0.5 + TAU, 0, 900))).toBeLessThan(0.01);
    // The plan's raw x-phase form aliases every 2π/b: these two are the same picture.
    const raw = (p: number) => sampleTarget(2, 3, p * 3, 0, 900);
    expect(shapeDistance(raw(0.5), raw(0.5 + TAU / 3))).toBeLessThan(0.01);
  });

  it('wrapAngle and phaseError stay in (−π, π]', () => {
    for (const x of [-10, -Math.PI, 0, Math.PI, 7, 100]) {
      const w = wrapAngle(x);
      expect(w).toBeGreaterThan(-Math.PI - 1e-12);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.abs(phaseError(x, 0, 2, 3))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });
});

describe('lock meter (plan §3.5)', () => {
  it('fills at 1/lockTime while m ≥ 0.85 (threshold inclusive)', () => {
    expect(stepLockMeter(0, LOCK_THRESHOLD, 0.5, 2.5)).toBeCloseTo(0.2, 12);
    let m = 0;
    for (let i = 0; i < 250; i++) m = stepLockMeter(m, 0.9, 0.01, 2.5);
    expect(m).toBeCloseTo(1, 9);
  });

  it('drains at half the fill rate below threshold and clamps to [0, 1]', () => {
    expect(stepLockMeter(0.5, 0.84, 1, 2)).toBeCloseTo(0.25, 12);
    expect(stepLockMeter(0.1, 0, 10, 2)).toBe(0);
    expect(stepLockMeter(0.99, 1, 10, 2)).toBe(1);
  });

  it('re-key resets to 50% if above 50%, otherwise to 0', () => {
    expect(rekeyMeterReset(0.9)).toBe(0.5);
    expect(rekeyMeterReset(0.51)).toBe(0.5);
    expect(rekeyMeterReset(0.5)).toBe(0);
    expect(rekeyMeterReset(0.2)).toBe(0);
  });
});

describe('rolling matches the frequency difference', () => {
  it('roll rate is zero at R = b/a and proportional to R·a − b', () => {
    expect(Math.abs(rollRate(1.5, 2, 3, SCOPE_HZ))).toBe(0);
    const r1 = rollRate(1.5 * 1.01, 2, 3, SCOPE_HZ);
    const r2 = rollRate(1.5 * 1.02, 2, 3, SCOPE_HZ);
    expect(r2 / r1).toBeCloseTo((1.5 * 1.02 * 2 - 3) / (1.5 * 1.01 * 2 - 3), 9);
    expect(Math.sign(rollRate(1.4, 2, 3, 1))).toBe(-Math.sign(rollRate(1.6, 2, 3, 1)));
  });

  it('the audible beat tracks the same difference', () => {
    expect(beatHz(1.5, 2, 3, 110)).toBe(0);
    expect(beatHz(1.52, 2, 3, 110)).toBeCloseTo(0.04 * 110, 9);
  });

  it('the drawn breaker figure returns to the same picture after one roll period, and differs at half', () => {
    const [a, b] = [2, 3];
    const R = 1.5 * 1.004; // close but not exact: slow visible roll
    const rate = Math.abs(rollRate(R, a, b, SCOPE_HZ));
    const T = 1 / rate;
    const dt = 1 / 120;
    let roll = 0;
    let theta = 0;
    const snap = () => sampleBreaker(R, 0.4 + roll, a, b, theta, 900);
    const start = snap();
    const steps = Math.round(T / dt);
    let half = start;
    for (let i = 1; i <= steps; i++) {
      roll = stepRoll(roll, R, a, b, dt);
      theta += TAU * SCOPE_HZ * dt;
      if (i === Math.round(steps / 2)) half = snap();
    }
    const end = snap();
    expect(shapeDistance(start, end)).toBeLessThan(0.03);
    expect(shapeDistance(start, half)).toBeGreaterThan(0.08);
  });

  it('when matched the breaker freezes and fuses with the target at equal phase', () => {
    const t = sampleTarget(3, 4, 1.1, 42.0, 600);
    const br = sampleBreaker(4 / 3, 1.1, 3, 4, 42.0, 600);
    for (let i = 0; i < 600; i++) {
      expect(br.x[i]).toBeCloseTo(t.x[i], 5);
      expect(br.y[i]).toBeCloseTo(t.y[i], 5);
    }
    expect(stepRoll(0.3, 4 / 3, 3, 4, 10)).toBeCloseTo(0.3, 9);
  });
});

describe('ratio knob detents', () => {
  it('has detents at every plan ratio and keeps them further apart than two zone widths', () => {
    for (const [a, b] of [
      [1, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 5],
      [4, 5],
      [5, 6],
    ]) {
      expect(DETENTS_LN.some((d) => Math.abs(d - Math.log(b / a)) < 1e-12)).toBe(true);
    }
    for (let i = 1; i < DETENTS_LN.length; i++)
      expect(DETENTS_LN[i] - DETENTS_LN[i - 1]).toBeGreaterThan(2 * DETENT_WIDTH);
  });

  it('is sticky near the centre, continuous at the edge, identity outside', () => {
    const d = Math.log(1.5);
    expect(applyDetent(d)).toBeCloseTo(d, 12);
    const near = applyDetent(d + DETENT_WIDTH * 0.5) - d;
    expect(near).toBeLessThan(DETENT_WIDTH * 0.5 * 0.3);
    expect(applyDetent(d + DETENT_WIDTH * 0.9999)).toBeCloseTo(d + DETENT_WIDTH, 4);
    expect(applyDetent(d + DETENT_WIDTH * 1.5)).toBe(d + DETENT_WIDTH * 1.5);
  });

  it('is monotonic, clamps to [0.25, 4], and purist mode disables detents', () => {
    let prev = -Infinity;
    for (let u = Math.log(0.2); u < Math.log(5); u += 0.0007) {
      const r = knobToR(u);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r;
    }
    expect(knobToR(Math.log(10))).toBeCloseTo(4, 12);
    expect(knobToR(Math.log(0.1))).toBeCloseTo(0.25, 12);
    const u = Math.log(1.5) + 0.005;
    expect(knobToR(u, true)).toBeCloseTo(Math.exp(u), 12);
    expect(Math.abs(Math.log(knobToR(u)) - Math.log(1.5))).toBeLessThan(0.005);
  });
});
