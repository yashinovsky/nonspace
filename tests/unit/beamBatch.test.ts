import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  Beam,
  BeamFlag,
  clipLineSet,
  clipSegmentNear,
  conserveWidth,
  createBeamBatch,
  createLineSet,
  fogFactor,
  lineSetCount,
} from '../../src/render/lines/BeamBatch';
import { buildStressLattice } from '../../src/debug/BeamLab';
import { createPalette } from '../../src/render/palette';

describe('clipSegmentNear', () => {
  const near = 0.5;

  it('keeps a fully visible segment', () => {
    const c = clipSegmentNear(-2, -8, near);
    expect(c.visible).toBe(true);
    expect(c.tA).toBe(0);
    expect(c.tB).toBe(1);
  });

  it('rejects a fully behind segment', () => {
    expect(clipSegmentNear(1, 4, near).visible).toBe(false);
    expect(clipSegmentNear(-0.1, -0.2, near).visible).toBe(false);
  });

  it('clips A onto the near plane with plan §8.5 t', () => {
    // A behind (z=+2), B in front (z=-10). da=-2, db=10.
    const c = clipSegmentNear(2, -10, near);
    expect(c.visible).toBe(true);
    expect(c.tA).toBeCloseTo((near - -2) / (10 - -2), 6);
    expect(c.tB).toBe(1);
  });

  it('clips B onto the near plane', () => {
    const c = clipSegmentNear(-10, 2, near);
    expect(c.visible).toBe(true);
    expect(c.tA).toBe(0);
    expect(c.tB).toBeCloseTo((near - 10) / (-2 - 10), 6);
  });
});

describe('conserveWidth', () => {
  it('leaves wide lines alone', () => {
    expect(conserveWidth(1.5)).toEqual({ width: 1.5, intensityScale: 1 });
  });

  it('clamps sub-pixel width and scales intensity', () => {
    expect(conserveWidth(0.25)).toEqual({ width: 1, intensityScale: 0.25 });
    expect(conserveWidth(0)).toEqual({ width: 1, intensityScale: 0 });
  });
});

describe('fogFactor', () => {
  it('is 1 before the start and fades after', () => {
    expect(fogFactor(10, 80, 0.001)).toBe(1);
    expect(fogFactor(80, 80, 0.001)).toBe(1);
    expect(fogFactor(180, 80, 0.001)).toBeCloseTo(Math.exp(-0.1), 8);
    expect(fogFactor(1000, 0, 0)).toBe(1);
  });
});

describe('clipLineSet', () => {
  it('returns a subarray view of the first N segments without copying', () => {
    const set = createLineSet(8, { width: true, flags: true });
    set.color[0] = Beam.GRID;
    set.color[3] = Beam.AMBER;
    const clipped = clipLineSet(set, 4);
    expect(lineSetCount(clipped)).toBe(4);
    expect(clipped.positions.buffer).toBe(set.positions.buffer);
    expect(clipLineSet(set, 8)).toBe(set);
    expect(lineSetCount(clipLineSet(set, 0))).toBe(0);
  });
});

describe('createBeamBatch', () => {
  it('uploads static and records dynamic pushes without overflowing capacity', () => {
    const palette = createPalette();
    const batch = createBeamBatch(palette, { capacity: 2 });
    const set = createLineSet(3, { width: true, flags: true });
    set.positions.set([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    set.color.set([Beam.GRID, Beam.AMBER, Beam.ESFA]);
    batch.setStatic(set);
    expect(batch.staticCount).toBe(3);
    expect(lineSetCount(set)).toBe(3);

    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    batch.beginDynamic();
    batch.push(a, b, Beam.ICE, 4, 0.25, BeamFlag.DWELL);
    batch.push(a, b, Beam.MIL);
    batch.push(a, b, Beam.GRID);
    batch.endDynamic();
    expect(batch.dynamicCount).toBe(2);
    expect(batch.object.children.length).toBe(2);
    batch.dispose();
  });
});

describe('stress lattice', () => {
  it('builds exactly 150k segments', () => {
    const set = buildStressLattice(150_000);
    expect(lineSetCount(set)).toBe(150_000);
    expect(set.positions.length).toBe(150_000 * 6);
  });
});
