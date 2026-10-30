/**
 * Military spiral arms (plan §5.5, §5.6, §8.6). Three logarithmic spirals of
 * MIL lightpoints on a disc at sky altitude. Pure generation — the GPU batch
 * and 0.1× parallax live in Sky.ts.
 */

import { pcg32, type Seed } from '../../core/rng';
import { Beam } from '../../render/lines/BeamBatch';
import { DEFAULT_POINT_SIZE, type PointSet } from '../../render/points/PointBatch';

export const SKY_ARM_COUNT = 3;
export const SKY_ARM_POINTS = 36_000;
export const SKY_POINTS_PER_ARM = SKY_ARM_POINTS / SKY_ARM_COUNT;
export const SKY_ALTITUDE = 30_000;
export const SKY_INNER_RADIUS = 8_000;
export const SKY_OUTER_RADIUS = 52_000;
export const SKY_TURNS = 1.15;
export const SKY_DISC_THICKNESS = 700;
/** ln(rOuter/rInner) / (turns · 2π) so θ=0 is inner and θ=max is outer. */
export const SKY_SPIRAL_K =
  Math.log(SKY_OUTER_RADIUS / SKY_INNER_RADIUS) / (SKY_TURNS * Math.PI * 2);
export const SKY_ARM_SEED_STREAM = 1;

export function logSpiralRadius(theta: number): number {
  return SKY_INNER_RADIUS * Math.exp(SKY_SPIRAL_K * theta);
}

export function armPhase(arm: number): number {
  return ((arm % SKY_ARM_COUNT) * Math.PI * 2) / SKY_ARM_COUNT;
}

/** Spine sample (no scatter) for tests and debug. `t` in [0, 1] along the arm. */
export function spiralSpine(
  arm: number,
  t: number,
): { x: number; y: number; z: number; r: number; theta: number } {
  const theta = t * SKY_TURNS * Math.PI * 2;
  const r = logSpiralRadius(theta);
  const a = theta + armPhase(arm);
  return {
    x: r * Math.cos(a),
    y: SKY_ALTITUDE,
    z: r * Math.sin(a),
    r,
    theta,
  };
}

/**
 * Writes `count` MIL points into `set` starting at `start`. `count` should be
 * a multiple of `SKY_ARM_COUNT` so the three arms stay even.
 */
export function fillSpiralArms(set: PointSet, start: number, count: number, seed: Seed): void {
  const n = Math.max(0, Math.min(count, set.color.length - start));
  const perArm = Math.floor(n / SKY_ARM_COUNT);
  const rng = pcg32(seed, SKY_ARM_SEED_STREAM);
  const sizes = set.size;
  let i = start;

  for (let arm = 0; arm < SKY_ARM_COUNT; arm++) {
    const phase = armPhase(arm);
    for (let k = 0; k < perArm; k++, i++) {
      const u = (k + rng.next()) / perArm;
      const theta = u * SKY_TURNS * Math.PI * 2;
      const r0 = logSpiralRadius(theta);
      const spread = rng.normal(0, r0 * 0.028);
      const along = rng.normal(0, r0 * 0.012);
      const r = Math.max(200, r0 + along);
      const a = theta + phase + rng.normal(0, 0.018);
      const p = i * 3;
      set.positions[p] = r * Math.cos(a);
      set.positions[p + 1] = SKY_ALTITUDE + rng.normal(0, SKY_DISC_THICKNESS * (0.35 + 0.65 * u));
      set.positions[p + 2] = r * Math.sin(a);
      // A little radial scatter perpendicular to the arm so they read as bands.
      const nx = -Math.sin(a);
      const nz = Math.cos(a);
      set.positions[p]! += nx * spread;
      set.positions[p + 2]! += nz * spread;
      set.color[i] = Beam.MIL;
      const edge = Math.min(1, Math.abs(spread) / Math.max(r0 * 0.028, 1));
      set.intensity[i] = 1.1 + (1.0 - edge) * rng.float(0.6, 2.2);
      if (sizes) sizes[i] = rng.float(2.2, 4.6);
    }
  }

  while (i < start + n) {
    const spine = spiralSpine(i % SKY_ARM_COUNT, rng.next());
    const p = i * 3;
    set.positions[p] = spine.x;
    set.positions[p + 1] = spine.y;
    set.positions[p + 2] = spine.z;
    set.color[i] = Beam.MIL;
    set.intensity[i] = 1.4;
    if (sizes) sizes[i] = DEFAULT_POINT_SIZE;
    i++;
  }
}
