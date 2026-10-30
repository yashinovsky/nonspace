import type { Matrix4 } from 'three';
import type { Vec3 } from '../../core/math/vec3';

/**
 * Beam palette indices (plan §5.3, §9.2). The plan writes a `const enum`; an
 * `as const` object is used instead because const enums don't survive
 * isolatedModules builds. Usage (`Beam.GRID`, `c: Beam`) is the same.
 */
export const Beam = {
  GRID: 0,
  AFTERGLOW: 1,
  MITSU: 2,
  TA: 3,
  ESFA: 4,
  AMBER: 5,
  ICE: 6,
  MIL: 7,
} as const;
export type Beam = (typeof Beam)[keyof typeof Beam];
export const BEAM_COUNT = 8;

/** Bits for `LineSet.flags` / `BeamBatch.push(..., f)`. */
export const BeamFlag = {
  DWELL: 1 << 0,
  KUANG: 1 << 1,
  NO_FOG: 1 << 2,
} as const;

export const DEFAULT_BEAM_WIDTH = 1.5;
export const DEFAULT_BEAM_INTENSITY = 1;

/** Produced by the construct grammar, HUD and effects. n = segment count. */
export interface LineSet {
  /** [ax, ay, az, bx, by, bz] * n */
  positions: Float32Array;
  /** Beam index * n */
  color: Uint8Array;
  /** * n */
  intensity: Float32Array;
  /** px * n, default DEFAULT_BEAM_WIDTH */
  width?: Float32Array;
  /** BeamFlag bits * n */
  flags?: Uint8Array;
}

export interface BeamBatch {
  readonly capacity: number;
  /** Upload once; replaces previous static contents. */
  setStatic(set: LineSet): void;
  /** Per-frame segments: beginDynamic, push..., endDynamic. Must not allocate. */
  beginDynamic(): void;
  push(a: Vec3, b: Vec3, c: Beam, i?: number, w?: number, f?: number): void;
  endDynamic(): void;
  /** Per-batch model matrix. */
  transform: Matrix4;
  visible: boolean;
  dispose(): void;
}

export interface LineSetOptions {
  width?: boolean;
  flags?: boolean;
}

export function createLineSet(segments: number, opts: LineSetOptions = {}): LineSet {
  const set: LineSet = {
    positions: new Float32Array(segments * 6),
    color: new Uint8Array(segments),
    intensity: new Float32Array(segments).fill(DEFAULT_BEAM_INTENSITY),
  };
  if (opts.width) set.width = new Float32Array(segments).fill(DEFAULT_BEAM_WIDTH);
  if (opts.flags) set.flags = new Uint8Array(segments);
  return set;
}

export function lineSetCount(set: LineSet): number {
  return set.color.length;
}
