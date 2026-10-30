import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/core/math/vec3';
import {
  clipPointSet,
  createPointSet,
  DEFAULT_POINT_SIZE,
  POINT_MIN_SIZE,
  POINT_REF_DISTANCE,
  pointSetCount,
  projectPointSize,
} from '../../src/render/points/PointBatch';
import { maxJointError, packPaths, samplePath, trafficPhase } from '../../src/render/points/path';
import lightPointFrag from '../../src/render/points/lightPoint.frag';
import lightPointVert from '../../src/render/points/lightPoint.vert';
import trafficVert from '../../src/render/points/traffic.vert';

describe('path texture', () => {
  it('stores cumulative arc length and samples at constant speed on a segment', () => {
    const packed = packPaths([new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 6])]);
    expect(packed.counts[0]).toBe(4); // closed with extra first vertex
    expect(packed.lengths[0]).toBeCloseTo(10 + 6 + Math.hypot(10, 6), 5);

    const a = vec3();
    const b = vec3();
    samplePath(packed, 0, 0.0, a);
    expect(a.x).toBeCloseTo(0, 5);
    expect(a.z).toBeCloseTo(0, 5);

    const len = packed.lengths[0]!;
    const dt = 0.01;
    samplePath(packed, 0, 1 / len, a); // 1 u along first segment
    samplePath(packed, 0, (1 + dt * len) / len, b);
    // still on the first 10 u segment: Euclidean step == arc step
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeCloseTo(dt * len, 4);
  });

  it('does not jump at a 90-degree joint', () => {
    const packed = packPaths([new Float32Array([0, 0, 0, 8, 0, 0, 8, 0, 5])], true);
    expect(maxJointError(packed)).toBeLessThan(1e-5);

    const jointS = 8;
    const t = jointS / packed.lengths[0]!;
    const at = vec3();
    const before = vec3();
    const after = vec3();
    samplePath(packed, 0, t, at);
    samplePath(packed, 0, t - 1e-6, before);
    samplePath(packed, 0, t + 1e-6, after);
    expect(at.x).toBeCloseTo(8, 4);
    expect(at.z).toBeCloseTo(0, 4);
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(
      0.002,
    );
  });

  it('wraps fract(t) without a teleport on a closed loop', () => {
    const packed = packPaths([new Float32Array([0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4])]);
    const a = vec3();
    const b = vec3();
    samplePath(packed, 0, 0.999, a);
    samplePath(packed, 0, 0.001, b);
    // both samples sit near the origin (the wrap vertex)
    expect(Math.hypot(a.x, a.z)).toBeLessThan(0.1);
    expect(Math.hypot(b.x, b.z)).toBeLessThan(0.1);
  });

  it('matches plan t = fract(time*speed/len + offset)', () => {
    expect(trafficPhase(2, 10, 20, 0.25)).toBeCloseTo(0.25, 10); // 2*10/20+0.25 = 1.25
    expect(trafficPhase(0, 1, 10, 0)).toBe(0);
  });
});

describe('point size attenuation', () => {
  it('clamps far points to 1.5 px and scales energy by area', () => {
    const far = projectPointSize(DEFAULT_POINT_SIZE, POINT_REF_DISTANCE * 40);
    expect(far.px).toBe(POINT_MIN_SIZE);
    expect(far.energy).toBeCloseTo((1 / 40) * (1 / 40), 8);

    const near = projectPointSize(4, POINT_REF_DISTANCE);
    expect(near.px).toBeCloseTo(4, 6);
    expect(near.energy).toBe(1);
  });
});

describe('PointSet helpers', () => {
  it('sizes arrays per point', () => {
    const set = createPointSet(60_000, { size: true });
    expect(pointSetCount(set)).toBe(60_000);
    expect(set.positions.length).toBe(180_000);
    expect(set.size?.[0]).toBe(DEFAULT_POINT_SIZE);
  });
});

describe('shaders', () => {
  it('lightPoint expands quads and draws a gaussian', () => {
    expect(lightPointVert).toContain('emitPoint');
    expect(lightPointVert).toContain('aPosition');
    expect(lightPointVert).not.toContain('#include');
    expect(lightPointFrag).toContain('exp(-r2');
  });

  it('traffic.vert samples a path texture at fract(time*speed/len + offset)', () => {
    expect(trafficVert).toContain('uPathTex');
    expect(trafficVert).toContain('fract(uTime * aSpeed / len + aPhase)');
    expect(trafficVert).toContain('sampleTrafficPath');
    expect(trafficVert).not.toContain('#include');
  });
});

describe('clipPointSet', () => {
  it('returns a subarray view of the first N points without copying', () => {
    const set = createPointSet(10, { size: true });
    set.positions[0] = 3;
    const clipped = clipPointSet(set, 4);
    expect(pointSetCount(clipped)).toBe(4);
    expect(clipped.positions.buffer).toBe(set.positions.buffer);
    expect(clipPointSet(set, 10)).toBe(set);
    expect(pointSetCount(clipPointSet(set, 0))).toBe(0);
  });
});
