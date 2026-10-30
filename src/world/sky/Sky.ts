/**
 * Sky layer (plan §8.3 skyScene): spiral arms + far constellations in one
 * PointBatch draw, 0.1× translation parallax, imperceptible spin.
 */

import { Group, type Object3D } from 'three';
import type { Vec3 } from '../../core/math/vec3';
import type { Palette } from '../../render/palette';
import {
  createPointBatch,
  createPointSet,
  pointSetCount,
  type GpuPointBatch,
  type PointSet,
} from '../../render/points/PointBatch';
import { fillFarConstellations, SKY_CONSTELLATION_POINTS } from './FarConstellations';
import { fillSpiralArms, SKY_ALTITUDE, SKY_ARM_POINTS } from './SpiralArms';

export const SKY_POINT_COUNT = 40_000;
export const SKY_PARALLAX = 0.1;
/** One revolution per 12 hours — visible only as a drift across a long session. */
export const SKY_SPIN_RAD_PER_SEC = (Math.PI * 2) / (12 * 3600);
export const SKY_SEED = 0x5e41_a201;
/** Pixel size is specified at this distance so 30 km dots still read. */
export const SKY_REF_DISTANCE = 5_000;
export const SKY_MAX_SIZE = 8;
export const CEILING_ALTITUDE = 12_000;

export {
  SKY_ALTITUDE,
  SKY_ARM_COUNT,
  SKY_ARM_POINTS,
  SKY_INNER_RADIUS,
  SKY_OUTER_RADIUS,
  SKY_TURNS,
} from './SpiralArms';
export { SKY_CONSTELLATION_MIN_Y, SKY_CONSTELLATION_POINTS } from './FarConstellations';

export function generateSkyPoints(seed: number = SKY_SEED): PointSet {
  const set = createPointSet(SKY_POINT_COUNT, { size: true });
  fillSpiralArms(set, 0, SKY_ARM_POINTS, seed);
  fillFarConstellations(set, SKY_ARM_POINTS, SKY_CONSTELLATION_POINTS, seed);
  return set;
}

/** World-space follow origin: sky moves at (1 − parallax) of the camera. */
export function skyFollow(cam: Vec3, out: Vec3, parallax = SKY_PARALLAX): Vec3 {
  const k = 1 - parallax;
  out.x = cam.x * k;
  out.y = cam.y * k;
  out.z = cam.z * k;
  return out;
}

/**
 * Remaining altitude from the camera to the disc after 0.1× parallax.
 * At the 12,000 u ceiling this is still ~28,800 u — the arms stay unreachable.
 */
export function skyApparentRange(camY: number, parallax = SKY_PARALLAX): number {
  return SKY_ALTITUDE - camY * parallax;
}

export interface Sky {
  readonly root: Group;
  readonly batch: GpuPointBatch;
  readonly points: PointSet;
  /** Current spin angle (radians). */
  angle: number;
  update(
    camera: { position: Vec3 },
    dt: number,
    opts?: {
      viewport?: { width: number; height: number };
      reduceMotion?: boolean;
      spinScale?: number;
      time?: number;
    },
  ): void;
  dispose(): void;
}

export interface SkyOptions {
  palette: Palette;
  parent: Object3D;
  seed?: number;
}

export function createSky(opts: SkyOptions): Sky {
  const points = generateSkyPoints(opts.seed ?? SKY_SEED);
  const batch = createPointBatch({
    capacity: SKY_POINT_COUNT,
    palette: opts.palette,
    fogDensity: 0,
    refDistance: SKY_REF_DISTANCE,
    minSize: 1.5,
    maxSize: SKY_MAX_SIZE,
  });
  batch.setStatic(points);
  batch.setFogDensity(0);

  const root = new Group();
  root.name = 'sky';
  root.matrixAutoUpdate = true;
  root.frustumCulled = false;
  root.renderOrder = -10;
  batch.object.name = 'skyPoints';
  batch.object.renderOrder = -10;
  root.add(batch.object);
  opts.parent.add(root);

  const follow = { x: 0, y: 0, z: 0 };
  let angle = 0;
  let time = 0;
  let disposed = false;

  const sky: Sky = {
    root,
    batch,
    points,
    get angle() {
      return angle;
    },
    set angle(v) {
      angle = v;
    },
    update(camera, dt, extra) {
      if (!extra?.reduceMotion) {
        angle += dt * SKY_SPIN_RAD_PER_SEC * (extra?.spinScale ?? 1);
      }
      time = extra?.time ?? time + dt;
      skyFollow(camera.position, follow);
      root.position.set(follow.x, follow.y, follow.z);
      root.rotation.y = angle;
      if (extra?.viewport) {
        batch.setViewport(extra.viewport.width, extra.viewport.height);
      }
      batch.setTime(time);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      opts.parent.remove(root);
      root.remove(batch.object);
      batch.dispose();
    },
  };

  if (pointSetCount(points) !== SKY_POINT_COUNT) {
    throw new Error(`sky point count ${pointSetCount(points)} != ${SKY_POINT_COUNT}`);
  }

  return sky;
}
