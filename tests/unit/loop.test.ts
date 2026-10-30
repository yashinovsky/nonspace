import { describe, expect, it } from 'vitest';
import { createLoop, SIM_DT } from '../../src/core/loop';
import { pcg32 } from '../../src/core/rng';

function harness(maxFrameTime?: number) {
  const dts: number[] = [];
  const alphas: number[] = [];
  const loop = createLoop({
    update: (dt) => dts.push(dt),
    render: (alpha) => alphas.push(alpha),
    maxFrameTime,
  });
  return { loop, dts, alphas };
}

describe('fixed-step loop', () => {
  it('runs one step per frame at 60 Hz', () => {
    const { loop, dts, alphas } = harness();
    for (let i = 0; i <= 60; i++) loop.frame((i * 1000) / 60);
    expect(dts.length).toBe(60);
    expect(alphas.length).toBe(61);
    expect(loop.stats.maxStepsPerFrame).toBe(1);
    expect(loop.stats.simTime).toBeCloseTo(1, 12);
  });

  it('keeps sim steps fixed and on schedule under a throttled, jittery frame rate', () => {
    const { loop, dts, alphas } = harness();
    const rng = pcg32(1);
    let now = 1000;
    loop.frame(now);
    // 10 s of frames between 30 ms and 200 ms: a CPU-starved tab at ~5–30 fps.
    while (now < 11_000) {
      now += rng.float(30, 200);
      loop.frame(now);
    }
    const elapsed = (now - 1000) / 1000;
    expect(new Set(dts)).toEqual(new Set([SIM_DT]));
    // Sim time tracks wall time to within one step; nothing was dropped.
    expect(Math.abs(loop.stats.simTime - elapsed)).toBeLessThan(SIM_DT);
    expect(loop.stats.droppedTime).toBe(0);
    expect(loop.stats.maxStepsPerFrame).toBeGreaterThan(1);
    expect(loop.stats.maxStepsPerFrame).toBeLessThanOrEqual(12);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    // alpha is exactly the unsimulated remainder.
    expect(loop.stats.alpha).toBeCloseTo((elapsed - loop.stats.simTime) / SIM_DT, 6);
  });

  it('runs no steps for frames faster than the sim and interpolates between them', () => {
    const { loop, dts, alphas } = harness();
    for (let i = 0; i <= 8; i++) loop.frame((i * 1000) / 240);
    expect(dts.length).toBe(2);
    expect(alphas.slice(0, 5)).toEqual([0, 0.25, 0.5, 0.75, 0].map((x) => expect.closeTo(x, 9)));
  });

  it('clamps long stalls instead of spiralling', () => {
    const { loop, dts } = harness(0.25);
    loop.frame(0);
    loop.frame(5000);
    expect(dts.length).toBe(15);
    expect(loop.stats.droppedTime).toBeCloseTo(4.75, 9);
  });

  it('does not advance while paused, and resetClock() ignores the gap', () => {
    const { loop, dts, alphas } = harness();
    loop.frame(0);
    loop.frame(50);
    const ticks = loop.stats.ticks;
    loop.paused = true;
    loop.frame(100);
    loop.frame(200);
    expect(loop.stats.ticks).toBe(ticks);
    expect(alphas.length).toBe(4);
    loop.paused = false;
    loop.resetClock();
    loop.frame(10_000);
    expect(loop.stats.ticks).toBe(ticks);
    loop.frame(10_000 + 1000 / 60);
    expect(dts.length).toBe(ticks + 1);
  });

  it('ignores clocks that go backwards', () => {
    const { loop, dts } = harness();
    loop.frame(1000);
    loop.frame(900);
    expect(dts.length).toBe(0);
    expect(loop.stats.frames).toBe(2);
  });

  it('rejects invalid options', () => {
    expect(() => createLoop({ update() {}, render() {}, step: 0 })).toThrow(RangeError);
    expect(() => createLoop({ update() {}, render() {}, maxFrameTime: 0.001 })).toThrow(RangeError);
  });
});
