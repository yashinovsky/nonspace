import { describe, expect, it } from 'vitest';
import { TENDRIL_CIRCLE_S, TENDRIL_DURATION, tendrilSample } from '../../src/campaign/tendril';

describe('M7.6 Berne tendril', () => {
  it('forms a circle, bulges to a sphere, then chases down the shaft', () => {
    expect(tendrilSample(0).phase).toBe('idle');
    expect(tendrilSample(TENDRIL_CIRCLE_S * 0.5).phase).toBe('circle');
    expect(tendrilSample(TENDRIL_CIRCLE_S * 0.5).radius).toBeGreaterThan(0);
    expect(tendrilSample(TENDRIL_CIRCLE_S * 0.5).bulge).toBe(0);
    const sphere = tendrilSample(TENDRIL_CIRCLE_S + 0.7);
    expect(sphere.phase).toBe('sphere');
    expect(sphere.bulge).toBeGreaterThan(0);
    expect(sphere.chase).toBe(0);
    const chase = tendrilSample(TENDRIL_DURATION - 0.2);
    expect(chase.phase).toBe('chase');
    expect(chase.chase).toBeGreaterThan(0.5);
    expect(tendrilSample(TENDRIL_DURATION).done).toBe(true);
    expect(tendrilSample(TENDRIL_DURATION).phase).toBe('done');
  });
});
