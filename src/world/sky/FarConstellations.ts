/**
 * Far-LOD data constellations (plan §5.5). Distant clusters of lightpoints
 * that read as city-lights of data — E&S night scenes, always above the
 * altitude ceiling. Packed into the same PointSet as the spiral arms.
 */

import { pcg32, type Seed } from '../../core/rng';
import { Beam } from '../../render/lines/BeamBatch';
import type { PointSet } from '../../render/points/PointBatch';
import { SKY_ALTITUDE } from './SpiralArms';

export const SKY_CONSTELLATION_POINTS = 4_000;
export const SKY_CONSTELLATION_CLUSTERS = 28;
export const SKY_CONSTELLATION_MIN_Y = 16_000;
export const SKY_CONSTELLATION_SEED_STREAM = 2;

const CLUSTER_BEAMS: readonly Beam[] = [
  Beam.GRID,
  Beam.AMBER,
  Beam.ICE,
  Beam.TA,
  Beam.MITSU,
  Beam.ESFA,
  Beam.GRID,
];

function clusterShares(n: number, weights: Float32Array): Uint16Array {
  const clusters = weights.length;
  const shares = new Uint16Array(clusters);
  let weightSum = 0;
  for (let c = 0; c < clusters; c++) weightSum += weights[c]!;
  let assigned = 0;
  for (let c = 0; c < clusters; c++) {
    shares[c] = Math.max(8, Math.floor((weights[c]! / weightSum) * n));
    assigned += shares[c]!;
  }
  let c = 0;
  while (assigned > n) {
    if (shares[c]! > 8) {
      shares[c]!--;
      assigned--;
    }
    c = (c + 1) % clusters;
  }
  while (assigned < n) {
    shares[c]!++;
    assigned++;
    c = (c + 1) % clusters;
  }
  return shares;
}

export function fillFarConstellations(
  set: PointSet,
  start: number,
  count: number,
  seed: Seed,
): void {
  const n = Math.max(0, Math.min(count, set.color.length - start));
  if (n === 0) return;
  const rng = pcg32(seed, SKY_CONSTELLATION_SEED_STREAM);
  const sizes = set.size;
  const clusters = SKY_CONSTELLATION_CLUSTERS;
  const weights = new Float32Array(clusters);
  for (let c = 0; c < clusters; c++) weights[c] = 40 + rng.float(0, 180);
  const shares = clusterShares(n, weights);

  let written = 0;
  for (let c = 0; c < clusters; c++) {
    const take = shares[c]!;
    const az = rng.float(0, Math.PI * 2);
    const radius = rng.float(22_000, 74_000);
    const cy = rng.float(SKY_CONSTELLATION_MIN_Y, SKY_ALTITUDE + 3_500);
    const cx = radius * Math.cos(az);
    const cz = radius * Math.sin(az);
    const sigma = rng.float(280, 1_600);
    const color = CLUSTER_BEAMS[c % CLUSTER_BEAMS.length]!;
    const bulge = rng.float(0.55, 1.6);

    for (let k = 0; k < take; k++, written++) {
      const i = start + written;
      const p = i * 3;
      set.positions[p] = cx + rng.normal(0, sigma);
      set.positions[p + 1] = Math.max(SKY_CONSTELLATION_MIN_Y, cy + rng.normal(0, sigma * 0.22));
      set.positions[p + 2] = cz + rng.normal(0, sigma);
      set.color[i] = color;
      set.intensity[i] = bulge * rng.float(0.45, 1.7);
      if (sizes) sizes[i] = rng.float(1.6, 3.4);
    }
  }
}
