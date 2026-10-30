import { describe, expect, it } from 'vitest';
import {
  createDynamicRes,
  DYNRES_DOWN_MS,
  DYNRES_MAX,
  DYNRES_MIN,
  DYNRES_STEP,
  DYNRES_STREAK,
  DYNRES_UP_MS,
} from '../../src/render/dynamicRes';

describe('dynamic resolution', () => {
  it('steps down after 30 frames over 15 ms, to a floor of 0.6', () => {
    const dyn = createDynamicRes();
    expect(dyn.scale).toBe(DYNRES_MAX);

    for (let i = 0; i < DYNRES_STREAK - 1; i++) {
      expect(dyn.sample(DYNRES_DOWN_MS + 1)).toBe(false);
    }
    expect(dyn.sample(DYNRES_DOWN_MS + 1)).toBe(true);
    expect(dyn.scale).toBeCloseTo(DYNRES_MAX - DYNRES_STEP);

    for (let step = 1; step < 4; step++) {
      for (let i = 0; i < DYNRES_STREAK - 1; i++) dyn.sample(20);
      expect(dyn.sample(20)).toBe(true);
    }
    expect(dyn.scale).toBe(DYNRES_MIN);
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(20);
    expect(dyn.scale).toBe(DYNRES_MIN);
  });

  it('steps back up when headroom returns', () => {
    const dyn = createDynamicRes();
    dyn.inject(20);
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(0);
    expect(dyn.scale).toBeCloseTo(0.9);
    dyn.inject(null);

    for (let i = 0; i < DYNRES_STREAK - 1; i++) {
      expect(dyn.sample(DYNRES_UP_MS - 1)).toBe(false);
    }
    expect(dyn.sample(DYNRES_UP_MS - 1)).toBe(true);
    expect(dyn.scale).toBe(DYNRES_MAX);
  });

  it('resets the streak when frame time crosses the threshold', () => {
    const dyn = createDynamicRes();
    for (let i = 0; i < DYNRES_STREAK - 1; i++) dyn.sample(20);
    dyn.sample(13);
    for (let i = 0; i < DYNRES_STREAK - 1; i++) dyn.sample(20);
    expect(dyn.scale).toBe(DYNRES_MAX);
  });

  it('ignores samples while disabled and reports scale 1', () => {
    const dyn = createDynamicRes();
    dyn.enabled = false;
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(40);
    expect(dyn.scale).toBe(1);
    dyn.enabled = true;
    expect(dyn.scale).toBe(1);
  });

  it('inject overrides sampled times until cleared', () => {
    const dyn = createDynamicRes();
    dyn.inject(20);
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(1);
    expect(dyn.scale).toBeCloseTo(0.9);
    expect(dyn.lastMs).toBe(20);
    dyn.inject(null);
    dyn.reset();
    expect(dyn.scale).toBe(1);
    expect(dyn.lastMs).toBeNull();
  });

  it('ignores null samples so missing GPU timers do not drop scale', () => {
    const dyn = createDynamicRes();
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(null);
    expect(dyn.scale).toBe(1);
    dyn.inject(20);
    for (let i = 0; i < DYNRES_STREAK; i++) dyn.sample(null);
    expect(dyn.scale).toBeCloseTo(0.9);
  });
});
