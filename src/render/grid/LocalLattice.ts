import type { Group } from 'three';
import type { Vec3 } from '../../core/math/vec3';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../lines/BeamBatch';
import type { Palette } from '../palette';
import { GRID_MAJOR } from './GroundGrid';

/** Plan §8.7: lattice ≤ 6k segments. */
export const LATTICE_MAX_SEGMENTS = 6_000;
/** Fade starts inside the radius so the window edge is already black. */
export const LATTICE_FADE_INNER = 0.55;
export const LATTICE_INTENSITY = 0.55;
export const LATTICE_WIDTH = 1.25;
/** Extra cell beyond the fade radius so new lines appear at fade 0. */
export const LATTICE_MARGIN_CELLS = 1;

export interface LatticeSeg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  fade: number;
}

export interface LocalLattice {
  readonly object: Group;
  readonly batch: BeamBatchGpu;
  readonly count: number;
  readonly origin: Vec3;
  radius: number;
  visible: boolean;
  update(camera: Vec3): void;
  dispose(): void;
}

export interface CreateLocalLatticeOptions {
  radius?: number;
  spacing?: number;
  intensity?: number;
  width?: number;
}

export function snapToLattice(v: number, spacing = GRID_MAJOR): number {
  const snapped = Math.round(v / spacing) * spacing;
  return snapped === 0 ? 0 : snapped;
}

export function writeLatticeOrigin(out: Vec3, camera: Vec3, spacing = GRID_MAJOR): Vec3 {
  out.x = snapToLattice(camera.x, spacing);
  out.y = snapToLattice(camera.y, spacing);
  out.z = snapToLattice(camera.z, spacing);
  return out;
}

export function latticeOrigin(camera: Vec3, spacing = GRID_MAJOR): Vec3 {
  return writeLatticeOrigin({ x: 0, y: 0, z: 0 }, camera, spacing);
}

export function latticeSegmentCount(halfCells: number): number {
  const n = 2 * halfCells + 1;
  return 3 * n * n * (n - 1);
}

/** Cells on each side of the snapped origin. Always large enough that the rim is faded out. */
export function latticeHalfCells(radius: number, spacing = GRID_MAJOR): number {
  const raw = Math.max(1, Math.ceil(radius / spacing) + LATTICE_MARGIN_CELLS);
  let half = raw;
  while (latticeSegmentCount(half) > LATTICE_MAX_SEGMENTS && half > 1) half--;
  return half;
}

export function latticeFade(dist: number, radius: number): number {
  if (radius <= 0 || dist >= radius) return 0;
  const inner = radius * LATTICE_FADE_INNER;
  if (dist <= inner) return 1;
  const t = (dist - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Walk every segment in the camera-centred window. No allocations besides the
 * callback; used by the GPU updater and by the no-pop unit test.
 */
export function forEachLatticeSegment(
  camera: Vec3,
  radius: number,
  fn: (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    fade: number,
  ) => void,
  spacing = GRID_MAJOR,
): void {
  const ox = snapToLattice(camera.x, spacing);
  const oy = snapToLattice(camera.y, spacing);
  const oz = snapToLattice(camera.z, spacing);
  const half = latticeHalfCells(radius, spacing);
  const cx = camera.x;
  const cy = camera.y;
  const cz = camera.z;

  const emit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;
    const fade = latticeFade(Math.hypot(mx - cx, my - cy, mz - cz), radius);
    fn(ax, ay, az, bx, by, bz, fade);
  };

  for (let iy = -half; iy <= half; iy++) {
    const y = oy + iy * spacing;
    for (let iz = -half; iz <= half; iz++) {
      const z = oz + iz * spacing;
      for (let ix = -half; ix < half; ix++) {
        const x0 = ox + ix * spacing;
        emit(x0, y, z, x0 + spacing, y, z);
      }
    }
  }
  for (let ix = -half; ix <= half; ix++) {
    const x = ox + ix * spacing;
    for (let iz = -half; iz <= half; iz++) {
      const z = oz + iz * spacing;
      for (let iy = -half; iy < half; iy++) {
        const y0 = oy + iy * spacing;
        emit(x, y0, z, x, y0 + spacing, z);
      }
    }
  }
  for (let ix = -half; ix <= half; ix++) {
    const x = ox + ix * spacing;
    for (let iy = -half; iy <= half; iy++) {
      const y = oy + iy * spacing;
      for (let iz = -half; iz < half; iz++) {
        const z0 = oz + iz * spacing;
        emit(x, y, z0, x, y, z0 + spacing);
      }
    }
  }
}

export function collectLatticeSegments(
  camera: Vec3,
  radius: number,
  spacing = GRID_MAJOR,
): LatticeSeg[] {
  const out: LatticeSeg[] = [];
  forEachLatticeSegment(
    camera,
    radius,
    (ax, ay, az, bx, by, bz, fade) => {
      out.push({ ax, ay, az, bx, by, bz, fade });
    },
    spacing,
  );
  return out;
}

export function createLocalLattice(
  palette: Palette,
  opts: CreateLocalLatticeOptions = {},
): LocalLattice {
  const spacing = opts.spacing ?? GRID_MAJOR;
  const intensity = opts.intensity ?? LATTICE_INTENSITY;
  const width = opts.width ?? LATTICE_WIDTH;
  let radius = opts.radius ?? 200;
  const origin = { x: 0, y: 0, z: 0 };
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const batch = createBeamBatch(palette, { capacity: LATTICE_MAX_SEGMENTS });
  batch.object.name = 'LocalLattice';
  batch.object.renderOrder = 1;
  let count = 0;

  const lattice: LocalLattice = {
    object: batch.object,
    batch,
    get count() {
      return count;
    },
    origin,
    get radius() {
      return radius;
    },
    set radius(v) {
      radius = Math.max(0, v);
    },
    get visible() {
      return batch.visible;
    },
    set visible(v) {
      batch.visible = v;
    },
    update(camera) {
      writeLatticeOrigin(origin, camera, spacing);
      batch.beginDynamic();
      forEachLatticeSegment(
        camera,
        radius,
        (ax, ay, az, bx, by, bz, fade) => {
          a.x = ax;
          a.y = ay;
          a.z = az;
          b.x = bx;
          b.y = by;
          b.z = bz;
          batch.push(a, b, Beam.GRID, intensity * fade, width, BeamFlag.NO_FOG);
        },
        spacing,
      );
      batch.endDynamic();
      count = batch.dynamicCount;
    },
    dispose() {
      batch.dispose();
    },
  };
  return lattice;
}
