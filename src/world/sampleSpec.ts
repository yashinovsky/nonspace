/**
 * M2.1 `sampleSpec` ranges, duplicated so tests can prove grammar compatibility
 * without pulling this into the sector lab chunk.
 */

import type { Pcg32 } from '../core/rng';
import type { Distribution, PrimitiveKind, PrimitiveSpec, SolidKind } from './constructs/grammar';

export function sampleMinorSpec(kind: PrimitiveKind, rng: Pcg32): PrimitiveSpec {
  switch (kind) {
    case 'box':
      return {
        kind,
        w: rng.float(4, 16),
        h: rng.float(4, 24),
        d: rng.float(4, 16),
        subdivisions: rng.int(0, 3),
        hatch: rng.chance(0.55),
      };
    case 'slabTerrace':
      return {
        kind,
        count: rng.int(3, 8),
        spacing: rng.float(0.5, 4),
        w: rng.float(12, 36),
        h: rng.float(1, 3),
        d: rng.float(4, 14),
        symmetry: rng.chance(0.7),
      };
    case 'cubeStack':
      return {
        kind,
        n: rng.int(2, 6),
        m: rng.int(2, 6),
        k: rng.int(2, 7),
        gap: rng.float(0, 0.5),
        blinkMask: rng.chance(0.4),
      };
    case 'ziggurat':
      return {
        kind,
        steps: rng.int(4, 9),
        base: rng.float(16, 40),
        stepH: rng.float(2, 5),
        inset: rng.float(1, 2.4),
      };
    case 'mast':
      return { kind, height: rng.float(18, 48), sections: rng.int(4, 8), dishes: rng.int(1, 4) };
    case 'nestedPoly': {
      const solids: SolidKind[] = ['tetra', 'octa', 'icosa'];
      return {
        kind,
        solid: rng.pick(solids),
        shells: rng.int(2, 5),
        rotationAxes: [0, 1, 2],
        radius: rng.float(5, 14),
        hatch: rng.chance(0.5),
      };
    }
    case 'geodesic':
      return { kind, frequency: rng.int(1, 3), radius: rng.float(6, 16) };
    case 'tower':
      return {
        kind,
        sides: rng.int(4, 8),
        height: rng.float(14, 40),
        taper: rng.float(0.15, 0.7),
        rings: rng.int(3, 8),
      };
    case 'constellation': {
      const dists: Distribution[] = ['uniform-sphere', 'gaussian', 'grid', 'cluster'];
      return { kind, n: rng.int(16, 80), distribution: rng.pick(dists) };
    }
    case 'spiralArms':
      return { kind, arms: rng.int(2, 5), points: rng.int(40, 160), pitch: rng.float(0.12, 0.4) };
  }
}
