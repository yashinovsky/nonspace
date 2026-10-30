import { describe, expect, it } from 'vitest';
import { LOCK_THRESHOLD, matchMetric } from '../../src/breach/PhaseLock';

describe('matchMetric', () => {
  it('is 1 at an exact ratio and phase match', () => {
    expect(matchMetric(3 / 2, 0.7, 2, 3, 0.7, 0.06)).toBeCloseTo(1, 12);
  });

  it('is 0 when phase is opposite', () => {
    expect(matchMetric(2, Math.PI, 1, 2, 0, 0.1)).toBeCloseTo(0, 12);
  });

  it('follows the plan formula for ratio error', () => {
    const tol = 0.06;
    const R = (3 / 2) * Math.exp(tol); // one tolerance off in log space
    expect(matchMetric(R, 0, 2, 3, 0, tol)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('follows the plan formula for phase error', () => {
    const dPhi = 0.4;
    const expected = (0.5 + 0.5 * Math.cos(dPhi)) ** 4;
    expect(matchMetric(1, dPhi, 1, 1, 0, 0.1)).toBeCloseTo(expected, 12);
  });

  it('wraps phase', () => {
    expect(matchMetric(1, 2 * Math.PI + 0.1, 1, 1, 0.1, 0.1)).toBeCloseTo(1, 12);
  });

  it('drops below the lock threshold quickly off-ratio', () => {
    expect(matchMetric(1.6, 0, 2, 3, 0, 0.06)).toBeLessThan(LOCK_THRESHOLD);
  });
});
