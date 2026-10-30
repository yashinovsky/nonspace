import { describe, expect, it } from 'vitest';
import { pcg32 } from '../../src/core/rng';
import { lineSetCount } from '../../src/render/lines/BeamBatch';
import { pointSetCount } from '../../src/render/points/PointBatch';
import {
  defaultSpec,
  generate,
  generateDefault,
  LOD_HYSTERESIS,
  MID_SEGMENT_BUDGET,
  NEAR_SEGMENT_BUDGET,
  PRIMITIVE_KINDS,
  sampleSpec,
  selectLod,
  tickLodFade,
  createLodFade,
  type PrimitiveKind,
  type PrimitiveSpec,
} from '../../src/world/constructs/grammar';

function cloneFloat32(a: Float32Array): number[] {
  return Array.from(a);
}

function uniqueUndirectedEdges(positions: Float32Array): number {
  const keys = new Set<string>();
  for (let i = 0; i < positions.length; i += 6) {
    const ax = positions[i]!;
    const ay = positions[i + 1]!;
    const az = positions[i + 2]!;
    const bx = positions[i + 3]!;
    const by = positions[i + 4]!;
    const bz = positions[i + 5]!;
    const a = `${ax},${ay},${az}`;
    const b = `${bx},${by},${bz}`;
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys.size;
}

describe('construct grammar', () => {
  it('emits every §8.6 primitive as LineSet + faces + PointSet', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const geom = generateDefault(kind, { seed: 7, lod: 'near' });
      expect(geom.lines.positions.length).toBe(geom.stats.segments * 6);
      expect(lineSetCount(geom.lines)).toBe(geom.stats.segments);
      expect(geom.faces.indices.length).toBe(geom.stats.triangles * 3);
      expect(pointSetCount(geom.points)).toBe(geom.stats.points);
      expect(Number.isFinite(geom.bounds.min.x)).toBe(true);
      expect(geom.bounds.max.x).toBeGreaterThanOrEqual(geom.bounds.min.x);
      for (const idx of geom.faces.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(geom.faces.positions.length / 3);
      }
    }
  });

  it('is deterministic for a given seed and params', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const spec = sampleSpec(kind, pcg32(42));
      const a = generate(spec, { seed: 99, lod: 'near' });
      const b = generate(spec, { seed: 99, lod: 'near' });
      expect(cloneFloat32(a.lines.positions)).toEqual(cloneFloat32(b.lines.positions));
      expect(Array.from(a.lines.color)).toEqual(Array.from(b.lines.color));
      expect(cloneFloat32(a.points.positions)).toEqual(cloneFloat32(b.points.positions));
      expect(Array.from(a.faces.indices)).toEqual(Array.from(b.faces.indices));
    }
  });

  it('sampleSpec is deterministic from PCG32', () => {
    const a = sampleSpec('ziggurat', pcg32(3));
    const b = sampleSpec('ziggurat', pcg32(3));
    expect(a).toEqual(b);
    expect(sampleSpec('cubeStack', pcg32(3))).not.toEqual(sampleSpec('cubeStack', pcg32(4)));
  });

  it('dedupes undirected edges so shared cube faces are not double-drawn', () => {
    const box = generate(
      { kind: 'box', w: 4, h: 4, d: 4, subdivisions: 0, hatch: false },
      { lod: 'near' },
    );
    expect(box.stats.segments).toBe(12);
    expect(uniqueUndirectedEdges(box.lines.positions)).toBe(12);

    const stacked = generate({ kind: 'cubeStack', n: 2, m: 1, k: 1, gap: 0 }, { lod: 'near' });
    // Two cubes sharing a face: 12 + 12 − 4 = 20 unique edges.
    expect(stacked.stats.segments).toBe(20);
    expect(uniqueUndirectedEdges(stacked.lines.positions)).toBe(stacked.stats.segments);

    const gapped = generate({ kind: 'cubeStack', n: 2, m: 1, k: 1, gap: 0.4 }, { lod: 'near' });
    expect(gapped.stats.segments).toBe(24);
  });

  it('box hatch adds diagonals without duplicating the 12 hull edges', () => {
    const plain = generate(
      { kind: 'box', w: 4, h: 4, d: 4, subdivisions: 0, hatch: false },
      { lod: 'near' },
    );
    const hatched = generate(
      { kind: 'box', w: 4, h: 4, d: 4, subdivisions: 0, hatch: true },
      { lod: 'near' },
    );
    expect(hatched.stats.segments).toBeGreaterThan(plain.stats.segments);
    expect(uniqueUndirectedEdges(hatched.lines.positions)).toBe(hatched.stats.segments);
  });

  it('constellation and spiralArms are points-first', () => {
    const stars = generate(
      { kind: 'constellation', n: 32, distribution: 'uniform-sphere' },
      { seed: 1, lod: 'near' },
    );
    expect(stars.stats.points).toBe(32);
    expect(stars.stats.segments).toBe(0);
    const sky = generate({ kind: 'spiralArms', arms: 3, points: 40, pitch: 0.2 }, { lod: 'near' });
    expect(sky.stats.points).toBe(120);
    expect(sky.stats.segments).toBe(0);
  });

  it('LOD far/mid/near stay inside the budget table', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const spec = defaultSpec(kind);
      const far = generate(spec, { lod: 'far', seed: 1 });
      expect(far.stats.points).toBe(1);
      expect(far.stats.segments).toBe(0);

      const mid = generate(spec, { lod: 'mid', seed: 1 });
      expect(mid.stats.segments).toBeGreaterThanOrEqual(MID_SEGMENT_BUDGET.min);
      expect(mid.stats.segments).toBeLessThanOrEqual(MID_SEGMENT_BUDGET.max);

      const near = generate(spec, { lod: 'near', seed: 1 });
      expect(near.stats.segments).toBeLessThanOrEqual(NEAR_SEGMENT_BUDGET[kind]);
      expect(uniqueUndirectedEdges(near.lines.positions)).toBe(near.stats.segments);
    }
  });

  it('selectLod applies hysteresis so a band around the threshold does not pop', () => {
    const h = LOD_HYSTERESIS;
    const near = 200;
    const mid = 2000;
    const dist = { near, mid };
    expect(selectLod(near, 'near', dist, h)).toBe('near');
    expect(selectLod(near * (1 + h) + 1, 'near', dist, h)).toBe('mid');
    expect(selectLod(near, 'mid', dist, h)).toBe('mid');
    expect(selectLod(near * (1 - h) - 1, 'mid', dist, h)).toBe('near');
    expect(selectLod(mid, 'mid', dist, h)).toBe('mid');
    expect(selectLod(mid * (1 + h) + 1, 'mid', dist, h)).toBe('far');
    expect(selectLod(mid, 'far', dist, h)).toBe('far');
    expect(selectLod(mid * (1 - h) - 1, 'far', dist, h)).toBe('mid');
  });

  it('LOD crossfade reaches 1 in 0.3 s', () => {
    let fade = createLodFade('near');
    fade = tickLodFade(fade, 5000, 0);
    expect(fade.to).toBe('far');
    expect(fade.mix).toBe(0);
    fade = tickLodFade(fade, 5000, 0.15);
    expect(fade.mix).toBeGreaterThan(0.4);
    expect(fade.mix).toBeLessThan(1);
    fade = tickLodFade(fade, 5000, 0.15);
    expect(fade.mix).toBe(1);
    expect(fade.current).toBe('far');
  });

  it('ESFA ziggurat is seven stepped slabs', () => {
    const spec: PrimitiveSpec = defaultSpec('ziggurat');
    expect(spec.kind === 'ziggurat' && spec.steps).toBe(7);
    const geom = generate(spec, { lod: 'near' });
    expect(geom.stats.segments).toBeGreaterThan(12);
    expect(geom.stats.triangles).toBeGreaterThan(0);
  });

  it('nestedPoly shells add edges and geodesic frequency densifies', () => {
    const octa1 = generate(
      { kind: 'nestedPoly', solid: 'octa', shells: 1, rotationAxes: [0], radius: 8 },
      { lod: 'near' },
    );
    const octa3 = generate(
      { kind: 'nestedPoly', solid: 'octa', shells: 3, rotationAxes: [0, 1, 2], radius: 8 },
      { lod: 'near' },
    );
    expect(octa3.stats.segments).toBeGreaterThan(octa1.stats.segments);

    const g1 = generate({ kind: 'geodesic', frequency: 1, radius: 10 }, { lod: 'near' });
    const g2 = generate({ kind: 'geodesic', frequency: 2, radius: 10 }, { lod: 'near' });
    expect(g1.stats.segments).toBe(30);
    expect(g2.stats.segments).toBeGreaterThan(g1.stats.segments);
  });

  it('every kind has a default spec of the same kind', () => {
    for (const kind of PRIMITIVE_KINDS as readonly PrimitiveKind[]) {
      expect(defaultSpec(kind).kind).toBe(kind);
    }
  });
});
