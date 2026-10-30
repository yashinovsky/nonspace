import { describe, expect, it } from 'vitest';
import { Beam } from '../../src/render/lines/BeamBatch';
import { pointSetCount } from '../../src/render/points/PointBatch';
import {
  SKY_CONSTELLATION_MIN_Y,
  SKY_CONSTELLATION_POINTS,
} from '../../src/world/sky/FarConstellations';
import {
  armPhase,
  fillSpiralArms,
  logSpiralRadius,
  SKY_ALTITUDE,
  SKY_ARM_COUNT,
  SKY_ARM_POINTS,
  SKY_INNER_RADIUS,
  SKY_OUTER_RADIUS,
  SKY_TURNS,
  spiralSpine,
} from '../../src/world/sky/SpiralArms';
import {
  CEILING_ALTITUDE,
  generateSkyPoints,
  SKY_PARALLAX,
  SKY_POINT_COUNT,
  SKY_SEED,
  SKY_SPIN_RAD_PER_SEC,
  skyApparentRange,
  skyFollow,
} from '../../src/world/sky/Sky';

describe('logarithmic spiral', () => {
  it('hits inner and outer radius at the ends of a turn', () => {
    expect(logSpiralRadius(0)).toBeCloseTo(SKY_INNER_RADIUS, 6);
    expect(logSpiralRadius(SKY_TURNS * Math.PI * 2)).toBeCloseTo(SKY_OUTER_RADIUS, 4);
  });

  it('places three arms 120° apart on the disc', () => {
    expect(SKY_ARM_COUNT).toBe(3);
    expect(armPhase(1) - armPhase(0)).toBeCloseTo((Math.PI * 2) / 3, 10);
    const a = spiralSpine(0, 0.4);
    const b = spiralSpine(1, 0.4);
    expect(a.r).toBeCloseTo(b.r, 6);
    expect(a.y).toBe(SKY_ALTITUDE);
    const az = Math.atan2(a.z, a.x);
    const bz = Math.atan2(b.z, b.x);
    let d = bz - az;
    while (d < 0) d += Math.PI * 2;
    while (d >= Math.PI * 2) d -= Math.PI * 2;
    expect(d).toBeCloseTo((Math.PI * 2) / 3, 5);
  });
});

describe('generateSkyPoints', () => {
  it('is 40k points, deterministic, and MIL arms plus far clusters', () => {
    const a = generateSkyPoints(SKY_SEED);
    const b = generateSkyPoints(SKY_SEED);
    const c = generateSkyPoints(SKY_SEED + 1);
    expect(pointSetCount(a)).toBe(SKY_POINT_COUNT);
    expect(SKY_ARM_POINTS + SKY_CONSTELLATION_POINTS).toBe(SKY_POINT_COUNT);
    expect(a.positions).toEqual(b.positions);
    expect(a.color).toEqual(b.color);
    expect(a.positions[0]).not.toBe(c.positions[0]);

    let mil = 0;
    let other = 0;
    let minArmY = Infinity;
    let maxArmY = -Infinity;
    for (let i = 0; i < SKY_ARM_POINTS; i++) {
      expect(a.color[i]).toBe(Beam.MIL);
      mil++;
      const y = a.positions[i * 3 + 1]!;
      if (y < minArmY) minArmY = y;
      if (y > maxArmY) maxArmY = y;
    }
    for (let i = SKY_ARM_POINTS; i < SKY_POINT_COUNT; i++) {
      expect(a.color[i]).not.toBe(Beam.MIL);
      other++;
      expect(a.positions[i * 3 + 1]!).toBeGreaterThanOrEqual(SKY_CONSTELLATION_MIN_Y);
    }
    expect(mil).toBe(SKY_ARM_POINTS);
    expect(other).toBe(SKY_CONSTELLATION_POINTS);
    expect(minArmY).toBeGreaterThan(SKY_ALTITUDE - 5_000);
    expect(maxArmY).toBeLessThan(SKY_ALTITUDE + 5_000);
  });

  it('keeps arm points near the three log-spiral spines', () => {
    const set = generateSkyPoints(SKY_SEED);
    const spines: Array<{ x: number; z: number }> = [];
    for (let arm = 0; arm < SKY_ARM_COUNT; arm++) {
      for (let s = 0; s <= 96; s++) spines.push(spiralSpine(arm, s / 96));
    }
    let total = 0;
    const samples = 1_200;
    const stride = Math.floor(SKY_ARM_POINTS / samples);
    for (let s = 0; s < samples; s++) {
      const i = s * stride;
      const x = set.positions[i * 3]!;
      const z = set.positions[i * 3 + 2]!;
      let best = Infinity;
      for (const p of spines) {
        const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
        if (d < best) best = d;
      }
      total += Math.sqrt(best);
    }
    const mean = total / samples;
    // Inter-arm spacing at mid-radius is tens of thousands of u; scatter is ~3%.
    expect(mean).toBeLessThan(2_800);
  });

  it('fillSpiralArms respects a caller-specified slice', () => {
    const set = generateSkyPoints(SKY_SEED);
    const copy = set.color.slice(0, 16);
    fillSpiralArms(set, 0, 0, 1);
    expect(Array.from(set.color.slice(0, 16))).toEqual(Array.from(copy));
  });
});

describe('parallax and spin', () => {
  it('is 0.1× so the ceiling still leaves ~28.8k u to the disc', () => {
    expect(SKY_PARALLAX).toBe(0.1);
    expect(skyApparentRange(0)).toBe(SKY_ALTITUDE);
    expect(skyApparentRange(CEILING_ALTITUDE)).toBeCloseTo(28_800, 5);
    const ground = skyApparentRange(0);
    const ceiling = skyApparentRange(CEILING_ALTITUDE);
    expect(ceiling / ground).toBeGreaterThan(0.95);
  });

  it('follows the camera at (1 − parallax)', () => {
    const out = { x: 0, y: 0, z: 0 };
    skyFollow({ x: 1_000, y: 12_000, z: -400 }, out);
    expect(out).toEqual({ x: 900, y: 10_800, z: -360 });
  });

  it('rotates at a clock hour-hand rate (one turn per 12 hours)', () => {
    const perMinute = SKY_SPIN_RAD_PER_SEC * 60 * (180 / Math.PI);
    expect(perMinute).toBeCloseTo(0.5, 5);
    expect(SKY_SPIN_RAD_PER_SEC * 12 * 3600).toBeCloseTo(Math.PI * 2, 10);
  });
});
