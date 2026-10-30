/**
 * Kuang body: Catmull-Rom spline of iridescent rib rings (plan §4.4 M5 / §5.5).
 * Pure math — no Three, no GPU.
 */

import type { Vec3 } from '../core/math/vec3';

export interface SplineSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

const _p0 = { x: 0, y: 0, z: 0 };
const _p1 = { x: 0, y: 0, z: 0 };
const _p2 = { x: 0, y: 0, z: 0 };
const _p3 = { x: 0, y: 0, z: 0 };

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function crT(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return (
    0.5 *
    (-p0 +
      p2 +
      (4 * p0 - 10 * p1 + 8 * p2 - 2 * p3) * t +
      (-3 * p0 + 9 * p1 - 9 * p2 + 3 * p3) * t2)
  );
}

/** Deploy pose: a long sinuous polychrome body in front of the T-A slab. */
export function deployControls(count = 9): Vec3[] {
  const n = Math.max(4, count | 0);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const s = t * Math.PI * 2;
    out.push({
      x: Math.sin(s * 1.15) * 3.4 + Math.sin(s * 2.3) * 0.7,
      y: (t - 0.5) * 14 + Math.cos(s * 0.9) * 1.1,
      z: -4 - t * 18 + Math.cos(s * 1.4) * 1.6,
    });
  }
  return out;
}

/** Helix coiled around a tube of `radius` along −Z, starting at `z0`. */
export function coilControls(
  radius: number,
  z0: number,
  length: number,
  turns = 2.4,
  count = 12,
): Vec3[] {
  const n = Math.max(4, count | 0);
  const r = radius * 1.16;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = t * turns * Math.PI * 2;
    out.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: z0 - t * length,
    });
  }
  return out;
}

/**
 * Sample a Catmull-Rom through `pts` at `u` in 0..1. Endpoints are duplicated
 * so the first and last authored points are reachable.
 */
export function sampleSpline(pts: readonly Vec3[], u: number, out: SplineSample): SplineSample {
  const n = pts.length;
  if (n === 0) {
    out.x = out.y = out.z = 0;
    out.tx = 0;
    out.ty = 1;
    out.tz = 0;
    return out;
  }
  if (n === 1) {
    const p = pts[0]!;
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.tx = 0;
    out.ty = 1;
    out.tz = 0;
    return out;
  }
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  const segs = n - 1;
  const x = t * segs;
  let i = Math.floor(x);
  if (i >= segs) i = segs - 1;
  const lt = x - i;
  const a = i <= 0 ? pts[0]! : pts[i - 1]!;
  const b = pts[i]!;
  const c = pts[i + 1] ?? pts[n - 1]!;
  const d = i + 2 >= n ? pts[n - 1]! : pts[i + 2]!;
  _p0.x = a.x;
  _p0.y = a.y;
  _p0.z = a.z;
  _p1.x = b.x;
  _p1.y = b.y;
  _p1.z = b.z;
  _p2.x = c.x;
  _p2.y = c.y;
  _p2.z = c.z;
  _p3.x = d.x;
  _p3.y = d.y;
  _p3.z = d.z;
  out.x = cr(_p0.x, _p1.x, _p2.x, _p3.x, lt);
  out.y = cr(_p0.y, _p1.y, _p2.y, _p3.y, lt);
  out.z = cr(_p0.z, _p1.z, _p2.z, _p3.z, lt);
  let tx = crT(_p0.x, _p1.x, _p2.x, _p3.x, lt);
  let ty = crT(_p0.y, _p1.y, _p2.y, _p3.y, lt);
  let tz = crT(_p0.z, _p1.z, _p2.z, _p3.z, lt);
  const len = Math.hypot(tx, ty, tz);
  if (len < 1e-6) {
    tx = 0;
    ty = 0;
    tz = -1;
  } else {
    tx /= len;
    ty /= len;
    tz /= len;
  }
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  return out;
}

export interface RibHit {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

/**
 * Write `sides` ring segments at `sample` into `out` starting at `start`.
 * Returns the next write index. Frenet frame uses world-up unless the tangent
 * is nearly vertical.
 */
export function writeRib(
  sample: SplineSample,
  radius: number,
  sides: number,
  out: RibHit[],
  start: number,
): number {
  const n = Math.max(3, sides | 0);
  let ux = 0;
  let uy = 1;
  let uz = 0;
  let cx = uy * sample.tz - uz * sample.ty;
  let cy = uz * sample.tx - ux * sample.tz;
  let cz = ux * sample.ty - uy * sample.tx;
  let cl = Math.hypot(cx, cy, cz);
  if (cl < 0.15) {
    ux = 1;
    uy = 0;
    uz = 0;
    cx = uy * sample.tz - uz * sample.ty;
    cy = uz * sample.tx - ux * sample.tz;
    cz = ux * sample.ty - uy * sample.tx;
    cl = Math.hypot(cx, cy, cz);
  }
  if (cl < 1e-6) {
    cx = 1;
    cy = 0;
    cz = 0;
    cl = 1;
  }
  cx /= cl;
  cy /= cl;
  cz /= cl;
  let bx = sample.ty * cz - sample.tz * cy;
  let by = sample.tz * cx - sample.tx * cz;
  let bz = sample.tx * cy - sample.ty * cx;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl;
  by /= bl;
  bz /= bl;

  let prevX = sample.x + cx * radius;
  let prevY = sample.y + cy * radius;
  let prevZ = sample.z + cz * radius;
  const firstX = prevX;
  const firstY = prevY;
  const firstZ = prevZ;
  let w = start;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = sample.x + (cx * ca + bx * sa) * radius;
    const y = sample.y + (cy * ca + by * sa) * radius;
    const z = sample.z + (cz * ca + bz * sa) * radius;
    const slot = out[w] ?? (out[w] = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 });
    if (i < n) {
      slot.ax = prevX;
      slot.ay = prevY;
      slot.az = prevZ;
      slot.bx = x;
      slot.by = y;
      slot.bz = z;
    } else {
      slot.ax = prevX;
      slot.ay = prevY;
      slot.az = prevZ;
      slot.bx = firstX;
      slot.by = firstY;
      slot.bz = firstZ;
    }
    prevX = x;
    prevY = y;
    prevZ = z;
    w++;
  }
  return w;
}

export function ribCount(ribs: number, sides: number): number {
  return Math.max(0, ribs | 0) * Math.max(3, sides | 0);
}

/** Unfold: only the first `reveal` fraction of the spline is solid. */
export function revealedRibs(total: number, reveal: number): number {
  const n = Math.max(0, total | 0);
  const r = reveal < 0 ? 0 : reveal > 1 ? 1 : reveal;
  return Math.max(0, Math.min(n, Math.round(n * r)));
}
