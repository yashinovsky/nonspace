import type { Matrix4 } from 'three';
import type { Vec3 } from '../../core/math/vec3';
import type { Beam } from '../lines/BeamBatch';

export const DEFAULT_POINT_SIZE = 1.5;

/** Lightpoints (plan §9.2). n = point count. */
export interface PointSet {
  /** [x, y, z] * n */
  positions: Float32Array;
  /** Beam index * n */
  color: Uint8Array;
  /** * n */
  intensity: Float32Array;
  /** px * n, default DEFAULT_POINT_SIZE (also the minimum on screen) */
  size?: Float32Array;
}

/** Mirrors BeamBatch for points. The plan only defines PointSet; this is owned by M1.2. */
export interface PointBatch {
  readonly capacity: number;
  setStatic(set: PointSet): void;
  beginDynamic(): void;
  push(p: Vec3, c: Beam, i?: number, size?: number): void;
  endDynamic(): void;
  transform: Matrix4;
  visible: boolean;
  dispose(): void;
}

export function createPointSet(points: number, opts: { size?: boolean } = {}): PointSet {
  const set: PointSet = {
    positions: new Float32Array(points * 3),
    color: new Uint8Array(points),
    intensity: new Float32Array(points).fill(1),
  };
  if (opts.size) set.size = new Float32Array(points).fill(DEFAULT_POINT_SIZE);
  return set;
}

export function pointSetCount(set: PointSet): number {
  return set.color.length;
}
