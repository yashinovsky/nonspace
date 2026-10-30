import { describe, expect, it } from 'vitest';
import { Beam, createLineSet } from '../../src/render/lines/BeamBatch';
import {
  WHITE_HATCH_DENSITY,
  GRAY_HATCH_DENSITY,
  WHITE_SHELLS,
  GRAY_SHELLS,
  BLACK_SHELLS,
  TELEGRAPH_FLICKER_HZ,
  classLook,
  hatchCoverage,
  telegraphFlicker,
} from '../../src/render/faces/iceFacetMath';
import { nestedRadii, buildShellGeom, shellMesh } from '../../src/render/faces/iceFacet';
import {
  SHATTER_DURATION,
  createShatter,
  rotateVec,
  seedShatter,
  shatterAlive,
  shatterFade,
  stepShatter,
} from '../../src/render/fx/Shatter';
import { WHITE_ICE } from '../../src/content/ice/white';
import { GRAY_ICE } from '../../src/content/ice/gray';
import { BLACK_ICE } from '../../src/content/ice/black';
import { iceLayerDefSchema } from '../../src/narrative/schema';

describe('ICE class looks', () => {
  it('white, gray, and black differ in shell count and hatch density', () => {
    const w = classLook('white');
    const g = classLook('gray');
    const b = classLook('black');
    expect(w.shells).toBe(WHITE_SHELLS);
    expect(g.shells).toBe(GRAY_SHELLS);
    expect(b.shells).toBe(BLACK_SHELLS);
    expect(g.density).toBeGreaterThan(w.density);
    expect(g.density).toBe(GRAY_HATCH_DENSITY);
    expect(w.density).toBe(WHITE_HATCH_DENSITY);
    expect(g.counterRotate).toBe(true);
    expect(w.counterRotate).toBe(false);
    expect(b.density).toBe(0);
    expect(w.intensity).toBeGreaterThan(g.intensity);
  });

  it('nested radii shrink inward', () => {
    const r = nestedRadii(12, 4);
    expect(r).toHaveLength(4);
    expect(r[0]!).toBeGreaterThan(r[1]!);
    expect(r[1]!).toBeGreaterThan(r[2]!);
  });

  it('hatch coverage produces a moiré product on overlapping strokes', () => {
    const a = hatchCoverage(0.5, 0.2, 0.1, GRAY_HATCH_DENSITY, 0.2, 0.41, 0.045);
    const b = hatchCoverage(0.51, 0.21, 0.11, WHITE_HATCH_DENSITY, 0.2, 0.41, 0.09);
    expect(a.cov).toBeGreaterThanOrEqual(0);
    expect(a.cov).toBeLessThanOrEqual(1);
    expect(a.moire).toBeLessThanOrEqual(a.lines + 1e-9);
    expect(b.cov).toBeGreaterThanOrEqual(0);
  });

  it('telegraph flicker stays at 2 Hz (photosensitivity)', () => {
    expect(TELEGRAPH_FLICKER_HZ).toBeLessThanOrEqual(3);
    expect(telegraphFlicker(0.125, 1)).not.toBeCloseTo(telegraphFlicker(0, 1), 3);
    expect(telegraphFlicker(0, 0)).toBe(0);
  });

  it('shell meshes match the authored kind', () => {
    expect(shellMesh('cube', 1).faces.length).toBe(6);
    expect(shellMesh('octa', 1).faces.length).toBe(8);
    expect(shellMesh('icosa', 1).faces.length).toBe(20);
    const cube = buildShellGeom('cube', 4, Beam.ICE, 1);
    expect(cube.faces.length).toBe(6);
    expect(cube.lines.color.length).toBeGreaterThan(8);
  });
});

describe('Shatter', () => {
  it('runs 1.2 s then dies', () => {
    const set = createLineSet(3, { width: true, flags: true });
    for (let i = 0; i < 3; i++) {
      const p = i * 6;
      set.positions[p] = i;
      set.positions[p + 3] = i + 1;
      set.color[i] = Beam.ICE;
      set.intensity[i] = 1;
    }
    const sim = createShatter(set, 1);
    expect(sim.duration).toBe(SHATTER_DURATION);
    expect(SHATTER_DURATION).toBeCloseTo(1.2);
    expect(sim.shards).toHaveLength(3);
    const y0 = sim.shards[0]!.cy;
    stepShatter(sim, 0.2);
    expect(sim.shards[0]!.cy).not.toBeCloseTo(y0, 5);
    expect(shatterAlive(sim.elapsed)).toBe(true);
    stepShatter(sim, 1.1);
    expect(shatterAlive(sim.elapsed)).toBe(false);
    expect(shatterFade(1.2)).toBe(0);
    expect(shatterFade(0.4)).toBe(1);
  });

  it('seedShatter is deterministic', () => {
    const set = createLineSet(2, { width: true, flags: true });
    set.positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1]);
    set.color[0] = Beam.ICE;
    set.color[1] = Beam.ICE;
    const a = seedShatter(set, 42);
    const b = seedShatter(set, 42);
    expect(a[0]!.vx).toBe(b[0]!.vx);
    expect(a[1]!.spin).toBe(b[1]!.spin);
  });

  it('rotateVec preserves length', () => {
    const p = { x: 1, y: 0, z: 0 };
    const out = { x: 0, y: 0, z: 0 };
    rotateVec(p, { x: 0, y: 1, z: 0 }, Math.PI / 2, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
    expect(out.z).toBeCloseTo(-1, 6);
  });
});

describe('ICE content', () => {
  it('white / gray / black defs validate and stay class-distinct', () => {
    for (const def of [WHITE_ICE, GRAY_ICE, BLACK_ICE]) {
      for (const layer of def.layers) iceLayerDefSchema.parse(layer);
    }
    expect(WHITE_ICE.class).toBe('white');
    expect(GRAY_ICE.class).toBe('gray');
    expect(BLACK_ICE.class).toBe('black');
    expect(WHITE_ICE.shell).toBe('cube');
    expect(GRAY_ICE.shell).toBe('octa');
    expect(BLACK_ICE.shell).toBe('icosa');
    expect(BLACK_ICE.layers.some((l) => l.grip)).toBe(true);
    expect(WHITE_ICE.layers.every((l) => !l.rekeyEvery)).toBe(true);
  });
});
