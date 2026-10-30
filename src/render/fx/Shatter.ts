import { Pcg32 } from '../../core/rng';
import { vec3, type Vec3 } from '../../core/math/vec3';
import {
  DEFAULT_BEAM_INTENSITY,
  DEFAULT_BEAM_WIDTH,
  lineSetCount,
  type LineSet,
} from '../lines/BeamBatch';

/** Cracked ICE layer fall/tumble (plan §5.5). Persistence trails come from M1.4. */
export const SHATTER_DURATION = 1.2;
export const SHATTER_GRAVITY = 22;
export const SHATTER_FADE_START = 0.85;

export interface ShatterShard {
  /** Endpoint A relative to centroid, at seed. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin axis (unit) and rad/s. */
  sx: number;
  sy: number;
  sz: number;
  spin: number;
  color: number;
  intensity: number;
  width: number;
  flags: number;
}

export interface ShatterSim {
  readonly shards: ShatterShard[];
  elapsed: number;
  readonly duration: number;
}

export function shatterAlive(elapsed: number, duration = SHATTER_DURATION): boolean {
  return elapsed >= 0 && elapsed < duration;
}

export function shatterFade(elapsed: number, duration = SHATTER_DURATION): number {
  if (elapsed < 0) return 0;
  if (elapsed >= duration) return 0;
  if (elapsed < SHATTER_FADE_START) return 1;
  return 1 - (elapsed - SHATTER_FADE_START) / Math.max(1e-6, duration - SHATTER_FADE_START);
}

/** Rodrigues step. */
export function rotateVec(p: Vec3, axis: Vec3, angle: number, out: Vec3): Vec3 {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const ax = axis.x / len;
  const ay = axis.y / len;
  const az = axis.z / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = (1 - c) * (ax * p.x + ay * p.y + az * p.z);
  out.x = p.x * c + d * ax + (ay * p.z - az * p.y) * s;
  out.y = p.y * c + d * ay + (az * p.x - ax * p.z) * s;
  out.z = p.z * c + d * az + (ax * p.y - ay * p.x) * s;
  return out;
}

export function seedShatter(set: LineSet, seed = 0x5a77e11): ShatterShard[] {
  const rng = new Pcg32(seed, 0x5a);
  const n = lineSetCount(set);
  const shards: ShatterShard[] = [];
  const pos = set.positions;
  for (let i = 0; i < n; i++) {
    const p = i * 6;
    const ax = pos[p]!;
    const ay = pos[p + 1]!;
    const az = pos[p + 2]!;
    const bx = pos[p + 3]!;
    const by = pos[p + 4]!;
    const bz = pos[p + 5]!;
    const cx = (ax + bx) * 0.5;
    const cy = (ay + by) * 0.5;
    const cz = (az + bz) * 0.5;
    const dx = ax - cx;
    const dy = ay - cy;
    const dz = az - cz;
    const nx = cx + rng.normal(0, 0.4);
    const ny = cy + rng.normal(0, 0.4);
    const nz = cz + rng.normal(0, 0.4);
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const speed = rng.float(6, 16);
    let sx = rng.normal(0, 1);
    let sy = rng.normal(0, 1);
    let sz = rng.normal(0, 1);
    const slen = Math.hypot(sx, sy, sz) || 1;
    sx /= slen;
    sy /= slen;
    sz /= slen;
    shards.push({
      ax: dx,
      ay: dy,
      az: dz,
      bx: bx - cx,
      by: by - cy,
      bz: bz - cz,
      cx,
      cy,
      cz,
      vx: (nx / nlen) * speed + rng.normal(0, 1.2),
      vy: (ny / nlen) * speed * 0.35 + rng.float(2, 8),
      vz: (nz / nlen) * speed + rng.normal(0, 1.2),
      sx,
      sy,
      sz,
      spin: rng.float(4, 11) * (rng.next() < 0.5 ? -1 : 1),
      color: set.color[i]!,
      intensity: set.intensity[i] ?? DEFAULT_BEAM_INTENSITY,
      width: set.width?.[i] ?? DEFAULT_BEAM_WIDTH,
      flags: set.flags?.[i] ?? 0,
    });
  }
  return shards;
}

export function createShatter(set: LineSet, seed?: number): ShatterSim {
  return { shards: seedShatter(set, seed), elapsed: 0, duration: SHATTER_DURATION };
}

const _off = vec3();
const _axis = vec3();

export function stepShatter(sim: ShatterSim, dt: number): void {
  if (dt <= 0 || !shatterAlive(sim.elapsed, sim.duration)) {
    sim.elapsed += dt;
    return;
  }
  sim.elapsed += dt;
  const axis = _axis;
  const off = _off;
  for (const s of sim.shards) {
    s.vy -= SHATTER_GRAVITY * dt;
    s.cx += s.vx * dt;
    s.cy += s.vy * dt;
    s.cz += s.vz * dt;
    const ang = s.spin * dt;
    axis.x = s.sx;
    axis.y = s.sy;
    axis.z = s.sz;
    off.x = s.ax;
    off.y = s.ay;
    off.z = s.az;
    rotateVec(off, axis, ang, off);
    s.ax = off.x;
    s.ay = off.y;
    s.az = off.z;
    off.x = s.bx;
    off.y = s.by;
    off.z = s.bz;
    rotateVec(off, axis, ang, off);
    s.bx = off.x;
    s.by = off.y;
    s.bz = off.z;
  }
}

export function shardWorldA(s: ShatterShard): Vec3 {
  return vec3(s.cx + s.ax, s.cy + s.ay, s.cz + s.az);
}

export function shardWorldB(s: ShatterShard): Vec3 {
  return vec3(s.cx + s.bx, s.cy + s.by, s.cz + s.bz);
}
