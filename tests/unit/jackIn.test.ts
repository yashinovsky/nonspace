import { describe, expect, it } from 'vitest';
import {
  CRT_COLLAPSE_DURATION,
  crtCollapseLuma,
  sampleCrtCollapse,
  sampleCrtCollapseLuma,
} from '../../src/render/fx/CrtCollapse';
import {
  JACK_IN_FULL,
  JACK_IN_SHORT,
  canSkipJackIn,
  countFlashes,
  gridRaceRadius,
  jackInDuration,
  sampleJackIn,
  sampleJackInLuma,
} from '../../src/render/fx/JackInSequence';

describe('jack-in timing', () => {
  it('is 5.5 s full and 1.2 s short', () => {
    expect(JACK_IN_FULL).toBe(5.5);
    expect(JACK_IN_SHORT).toBe(1.2);
    expect(jackInDuration('full')).toBe(5.5);
    expect(jackInDuration('short')).toBe(1.2);
  });

  it('runs black → phosphenes → origami → race → landmarks → hud', () => {
    const d = JACK_IN_FULL;
    expect(sampleJackIn(0, d).phase).toBe('black');
    expect(sampleJackIn(0.4, d).phase).toBe('phosphenes');
    expect(sampleJackIn(0.4, d).phosphene).toBeGreaterThan(0.2);
    expect(sampleJackIn(1.8, d).phase).toBe('origami');
    expect(sampleJackIn(1.8, d).fold).toBeGreaterThan(0.15);
    expect(sampleJackIn(3.4, d).phase).toBe('race');
    expect(sampleJackIn(3.4, d).radius).toBeGreaterThan(gridRaceRadius(0.2));
    expect(sampleJackIn(4.2, d).landmark).toBeGreaterThan(0.4);
    expect(sampleJackIn(5.2, d).phase).toBe('hud');
    expect(sampleJackIn(5.2, d).hud).toBeGreaterThan(0.5);
    expect(sampleJackIn(5.5, d).phase).toBe('done');
    expect(sampleJackIn(5.5, d).hud).toBe(1);
  });

  it('compresses the same beat into 1.2 s', () => {
    const a = sampleJackIn(2.75, JACK_IN_FULL);
    const b = sampleJackIn(0.6, JACK_IN_SHORT);
    expect(b.phase).toBe(a.phase);
    expect(b.fold).toBeCloseTo(a.fold, 2);
    expect(b.hud).toBeCloseTo(a.hud, 2);
  });

  it('is skippable only after the first viewing', () => {
    expect(canSkipJackIn(false)).toBe(false);
    expect(canSkipJackIn(true)).toBe(true);
  });

  it('passes the flash rule when stepping 60 Hz frames', () => {
    for (const d of [JACK_IN_FULL, JACK_IN_SHORT]) {
      const samples = sampleJackInLuma(d, 60, false);
      expect(Math.max(...samples)).toBeLessThan(0.35);
      expect(countFlashes(samples, 0.12)).toBeLessThanOrEqual(3);
      const perSec = countFlashes(samples, 0.08) / d;
      expect(perSec).toBeLessThanOrEqual(3);
      const reduced = sampleJackInLuma(d, 60, true);
      expect(Math.max(...reduced)).toBeLessThanOrEqual(Math.max(...samples) + 1e-6);
    }
  });

  it('grows grid radius exponentially during race-out', () => {
    expect(gridRaceRadius(0)).toBe(6);
    expect(gridRaceRadius(1)).toBeCloseTo(22_000, 0);
    expect(gridRaceRadius(0.5)).toBeGreaterThan(gridRaceRadius(0.25));
  });
});

describe('CRT collapse', () => {
  it('lasts 0.6 s and squashes Y then X then fades', () => {
    expect(CRT_COLLAPSE_DURATION).toBe(0.6);
    const t0 = sampleCrtCollapse(0);
    expect(t0.scaleX).toBeCloseTo(1, 3);
    expect(t0.scaleY).toBeCloseTo(1, 3);
    expect(t0.fade).toBeCloseTo(1, 3);
    const line = sampleCrtCollapse(0.28);
    expect(line.scaleY).toBeLessThan(0.25);
    expect(line.scaleX).toBeGreaterThan(line.scaleY);
    const dot = sampleCrtCollapse(0.48);
    expect(dot.scaleX).toBeLessThan(0.2);
    expect(dot.scaleY).toBeLessThan(0.2);
    const end = sampleCrtCollapse(0.6);
    expect(end.fade).toBe(0);
  });

  it('does not strobe (≤ 3 flashes/s, low contrast)', () => {
    const samples = sampleCrtCollapseLuma(0.6, 60);
    expect(Math.max(...samples)).toBeLessThan(0.45);
    expect(countFlashes(samples, 0.2)).toBeLessThanOrEqual(2);
    const dt = samples.map((v, i) => (i === 0 ? 0 : Math.abs(v - samples[i - 1]!)));
    expect(Math.max(...dt)).toBeLessThan(0.2);
    expect(crtCollapseLuma(sampleCrtCollapse(0.6))).toBe(0);
  });
});
