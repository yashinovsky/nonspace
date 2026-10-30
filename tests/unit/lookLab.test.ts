import { describe, expect, it } from 'vitest';
import { Beam, BeamFlag, createLineSet } from '../../src/render/lines/BeamBatch';
import { createPalette } from '../../src/render/palette';
import { createPointSet } from '../../src/render/points/PointBatch';
import {
  countDwellFlags,
  fillPlaceholderArms,
  LOOK_SKY_POINTS,
  setPaletteGrayscale,
} from '../../src/debug/LookLab';
import { generate } from '../../src/world/constructs/grammar';

describe('M1.9 Look Lab helpers', () => {
  it('counts DWELL flags on a LineSet', () => {
    const set = createLineSet(4, { flags: true });
    set.flags![0] = BeamFlag.DWELL;
    set.flags![1] = 0;
    set.flags![2] = BeamFlag.DWELL | BeamFlag.NO_FOG;
    set.flags![3] = BeamFlag.NO_FOG;
    expect(countDwellFlags(set)).toBe(2);
  });

  it('near-LOD constructs carry vertex dwell', () => {
    const geom = generate(
      { kind: 'ziggurat', steps: 5, base: 20, stepH: 2.4, inset: 1.6 },
      { color: Beam.ESFA, lod: 'near', seed: 1 },
    );
    expect(geom.stats.segments).toBeGreaterThan(12);
    expect(countDwellFlags(geom.lines)).toBeGreaterThan(8);
  });

  it('placeholder arms are deterministic 3-arm MIL points', () => {
    const a = createPointSet(LOOK_SKY_POINTS, { size: true });
    const b = createPointSet(LOOK_SKY_POINTS, { size: true });
    expect(fillPlaceholderArms(a, LOOK_SKY_POINTS)).toBe(LOOK_SKY_POINTS);
    fillPlaceholderArms(b, LOOK_SKY_POINTS);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(new Set(a.color).size).toBe(1);
    expect(a.color[0]).toBe(Beam.MIL);
    const ys = new Set<number>();
    for (let i = 0; i < 200; i++) ys.add(Math.round(a.positions[i * 3]!));
    expect(ys.size).toBeGreaterThan(8);
  });

  it('palette grayscale is reversible via reset', () => {
    const palette = createPalette();
    const out = { r: 0, g: 0, b: 0 };
    palette.get(Beam.ESFA, out);
    const color = { ...out };
    setPaletteGrayscale(palette, true);
    palette.get(Beam.ESFA, out);
    expect(out.r).toBeCloseTo(out.g, 6);
    expect(out.g).toBeCloseTo(out.b, 6);
    expect(out.r).toBeGreaterThan(0.1);
    setPaletteGrayscale(palette, false);
    palette.get(Beam.ESFA, out);
    expect(out.r).toBeCloseTo(color.r, 6);
    expect(out.g).toBeCloseTo(color.g, 6);
    expect(out.b).toBeCloseTo(color.b, 6);
  });
});
