import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  CHECKER_INTENSITY,
  GRID_FOG_START,
  GRID_MAJOR,
  GRID_MINOR,
  GRID_MINOR_WIDTH,
  GRID_SUPER,
  checkerCell,
  checkerNearFade,
  createGroundGrid,
  densityFade,
  distToLineInCells,
  emptyWarp,
  gridDistanceFade,
  gridRadiusFade,
  pristineLine,
  warpXZ,
  type WarpPoint,
} from '../../src/render/grid/GroundGrid';
import {
  LATTICE_MAX_SEGMENTS,
  collectLatticeSegments,
  createLocalLattice,
  latticeFade,
  latticeHalfCells,
  latticeOrigin,
  latticeSegmentCount,
  snapToLattice,
} from '../../src/render/grid/LocalLattice';
import { createPalette } from '../../src/render/palette';
import { resolveQuality } from '../../src/render/quality';

const gpu = { hdr: true, renderer: 'NVIDIA GeForce RTX 4070' };

function segKey(s: {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}): string {
  return `${s.ax},${s.ay},${s.az}|${s.bx},${s.by},${s.bz}`;
}

describe('densityFade / pristineLine', () => {
  it('is 1 at low deriv and 0 once a cell is sub-pixel', () => {
    expect(densityFade(0.1)).toBe(1);
    expect(densityFade(0.25)).toBe(1);
    expect(densityFade(0.5)).toBeCloseTo(0.5, 5);
    expect(densityFade(0.75)).toBe(0);
    expect(densityFade(2)).toBe(0);
  });

  it('lights a line at integers and is dark at cell centres', () => {
    const deriv = 0.05;
    expect(pristineLine(0, deriv, GRID_MINOR_WIDTH)).toBeGreaterThan(0.9);
    expect(pristineLine(1, deriv, GRID_MINOR_WIDTH)).toBeGreaterThan(0.9);
    expect(pristineLine(0.5, deriv, GRID_MINOR_WIDTH)).toBe(0);
    expect(distToLineInCells(0)).toBeCloseTo(0, 10);
    expect(distToLineInCells(0.5)).toBeCloseTo(0.5, 10);
  });

  it('kills minor lines when fwidth(world/8) is grazing', () => {
    // ~10 u/px at the horizon ⇒ fwidth(x/8) ≈ 1.25, past the Nyquist fade.
    expect(pristineLine(0, 1.25, GRID_MINOR_WIDTH)).toBe(0);
  });
});

describe('distance fade and checker', () => {
  it('is 1 near the camera and black well before a 40 km edge', () => {
    expect(gridDistanceFade(0)).toBe(1);
    expect(gridDistanceFade(GRID_FOG_START)).toBe(1);
    expect(gridDistanceFade(5_000)).toBeGreaterThan(0.35);
    expect(gridDistanceFade(5_000)).toBeLessThan(0.5);
    expect(gridDistanceFade(40_000)).toBeLessThan(0.001);
  });

  it('alternates 8 u cells and fades the fill with distance', () => {
    expect(checkerCell(4, 4)).toBe(0);
    expect(checkerCell(12, 4)).toBe(1);
    expect(CHECKER_INTENSITY).toBeCloseTo(0.02, 8);
    expect(checkerNearFade(0)).toBe(1);
    expect(checkerNearFade(220)).toBe(0);
    expect(checkerNearFade(110)).toBeCloseTo(0.75, 5);
  });

  it('race-out radius is infinite by default and fades at the rim', () => {
    expect(gridRadiusFade(100, 1e9)).toBe(1);
    expect(gridRadiusFade(10, 100)).toBe(1);
    expect(gridRadiusFade(100, 100)).toBe(0);
    expect(gridRadiusFade(91, 100)).toBeGreaterThan(0);
    expect(gridRadiusFade(91, 100)).toBeLessThan(1);
    const grid = createGroundGrid(createPalette());
    expect(grid.radius).toBeGreaterThan(1e8);
    grid.setRadius(64);
    expect(grid.radius).toBe(64);
    grid.dispose();
  });
});

describe('warp field', () => {
  const bump: WarpPoint = { x: 0, z: 0, radius: 100, strength: 1 };

  it('is identity with zero-strength points and at the control point', () => {
    expect(warpXZ(40, 25, emptyWarp())).toEqual({ x: 40, z: 25 });
    expect(warpXZ(0, 0, [bump])).toEqual({ x: 0, z: 0 });
  });

  it('pushes outward and is nearly identity far from the radius', () => {
    const p = warpXZ(50, 0, [bump]);
    expect(p.x).toBeGreaterThan(50);
    expect(p.z).toBeCloseTo(0, 8);
    const far = warpXZ(4000, 0, [bump]);
    expect(far.x).toBeCloseTo(4000, 6);
    expect(far.z).toBeCloseTo(0, 8);
  });

  it('bends with four control points', () => {
    const four: WarpPoint[] = [
      { x: 128, z: 0, radius: 180, strength: 0.7 },
      { x: -120, z: 96, radius: 160, strength: 0.55 },
      { x: 16, z: -176, radius: 200, strength: -0.5 },
      { x: 96, z: 160, radius: 140, strength: 0.65 },
    ];
    const p = warpXZ(80, 0, four);
    expect(Math.hypot(p.x - 80, p.z - 0)).toBeGreaterThan(5);
  });
});

describe('local lattice window', () => {
  it('snaps to 64 u and sizes the window under the 6k budget', () => {
    expect(GRID_MINOR).toBe(8);
    expect(GRID_MAJOR).toBe(64);
    expect(GRID_SUPER).toBe(1024);
    expect(snapToLattice(31.9)).toBe(0);
    expect(snapToLattice(32.1)).toBe(64);
    expect(latticeOrigin({ x: 70, y: 100, z: -20 })).toEqual({ x: 64, y: 128, z: 0 });

    const high = resolveQuality('high', gpu).latticeRadius;
    const low = resolveQuality('low', gpu).latticeRadius;
    expect(high).toBe(200);
    expect(low).toBe(120);
    expect(latticeSegmentCount(latticeHalfCells(high))).toBeLessThanOrEqual(LATTICE_MAX_SEGMENTS);
    expect(latticeSegmentCount(latticeHalfCells(low))).toBeLessThanOrEqual(LATTICE_MAX_SEGMENTS);
    expect(latticeSegmentCount(latticeHalfCells(high))).toBeGreaterThan(1000);
  });

  it('fades smoothly to 0 at the radius', () => {
    expect(latticeFade(0, 200)).toBe(1);
    expect(latticeFade(100, 200)).toBe(1);
    expect(latticeFade(200, 200)).toBe(0);
    expect(latticeFade(250, 200)).toBe(0);
    const mid = latticeFade(200 * 0.775, 200);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });

  it('does not pop: segments that enter or leave the window are already faded out', () => {
    const radius = 200;
    const before = collectLatticeSegments({ x: 31.9, y: 80, z: 10 }, radius);
    const after = collectLatticeSegments({ x: 32.1, y: 80, z: 10 }, radius);
    expect(before.length).toBe(after.length);
    expect(before.length).toBe(latticeSegmentCount(latticeHalfCells(radius)));

    const beforeMap = new Map(before.map((s) => [segKey(s), s]));
    const afterMap = new Map(after.map((s) => [segKey(s), s]));

    let appeared = 0;
    let disappeared = 0;
    for (const s of after) {
      if (!beforeMap.has(segKey(s))) {
        appeared++;
        expect(s.fade).toBeLessThan(0.02);
      }
    }
    for (const s of before) {
      if (!afterMap.has(segKey(s))) {
        disappeared++;
        expect(s.fade).toBeLessThan(0.02);
      }
    }
    expect(appeared).toBeGreaterThan(0);
    expect(disappeared).toBeGreaterThan(0);

    const sharedBright = after.filter(
      (s) => (beforeMap.get(segKey(s))?.fade ?? 0) > 0.5 && s.fade > 0.5,
    );
    expect(sharedBright.length).toBeGreaterThan(80);
  });
});

describe('GPU objects', () => {
  it('creates a ray-plane grid and a BeamBatch lattice without overflowing 6k', () => {
    const palette = createPalette();
    const grid = createGroundGrid(palette);
    const lattice = createLocalLattice(palette, { radius: 200 });
    expect(lattice.object.name).toBe('LocalLattice');

    grid.setWarp([{ x: 10, z: -4, radius: 80, strength: 0.4 }]);
    expect(grid.getWarp()[0]).toEqual({ x: 10, z: -4, radius: 80, strength: 0.4 });
    expect(grid.getWarp()[3]?.strength).toBe(0);

    grid.follow({ x: 12, z: -9 });
    expect(grid.object.name).toBe('GroundGrid');

    lattice.update(new Vector3(12, 40, -9));
    expect(lattice.count).toBe(latticeSegmentCount(latticeHalfCells(200)));
    expect(lattice.count).toBeLessThanOrEqual(LATTICE_MAX_SEGMENTS);
    expect(lattice.origin).toEqual({ x: 0, y: 64, z: 0 });

    lattice.dispose();
    grid.dispose();
  });
});
