/**
 * Manhattan traffic routing along the 64 u grid (plan §8.6). Paths are
 * axis-aligned polylines: X, then Z, then Y. MST + extra edges live in Sector.ts.
 */

import { MAJOR_GRID, snapToGrid } from '../coords';

export interface XzPoint {
  x: number;
  z: number;
}

/** `[x,y,z] * n` polyline. Degenerate (zero-length) segments are dropped. */
export function manhattanRoute(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  grid: number = MAJOR_GRID,
): Float32Array {
  const x0 = snapToGrid(ax, grid);
  const z0 = snapToGrid(az, grid);
  const x1 = snapToGrid(bx, grid);
  const z1 = snapToGrid(bz, grid);
  const pts: number[] = [x0, ay, z0];
  const push = (x: number, y: number, z: number): void => {
    const n = pts.length;
    if (n >= 3 && pts[n - 3] === x && pts[n - 2] === y && pts[n - 1] === z) return;
    pts.push(x, y, z);
  };
  if (x1 !== x0) push(x1, ay, z0);
  if (z1 !== z0) push(x1, ay, z1);
  if (by !== ay) push(x1, by, z1);
  if (pts.length === 3) push(x1, by, z1);
  return Float32Array.from(pts);
}

export function polylineLength(path: ArrayLike<number>): number {
  let len = 0;
  for (let i = 3; i < path.length; i += 3) {
    const dx = path[i]! - path[i - 3]!;
    const dy = path[i + 1]! - path[i - 2]!;
    const dz = path[i + 2]! - path[i - 1]!;
    len += Math.hypot(dx, dy, dz);
  }
  return len;
}

/** Walk a polyline until `maxLen` of arc; always keeps at least two vertices. */
export function clipPolyline(path: ArrayLike<number>, maxLen: number): Float32Array {
  if (!(maxLen > 0) || path.length < 6) return Float32Array.from(path);
  const out: number[] = [path[0]!, path[1]!, path[2]!];
  let used = 0;
  for (let i = 3; i < path.length; i += 3) {
    const ax = out[out.length - 3]!;
    const ay = out[out.length - 2]!;
    const az = out[out.length - 1]!;
    const bx = path[i]!;
    const by = path[i + 1]!;
    const bz = path[i + 2]!;
    const seg = Math.hypot(bx - ax, by - ay, bz - az);
    if (used + seg <= maxLen + 1e-6) {
      out.push(bx, by, bz);
      used += seg;
      continue;
    }
    const t = Math.max(0, (maxLen - used) / (seg || 1));
    out.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    break;
  }
  if (out.length < 6) out.push(path[3]!, path[4]!, path[5]!);
  return Float32Array.from(out);
}

export function routeToward(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  maxLen: number,
  grid: number = MAJOR_GRID,
): Float32Array {
  return clipPolyline(manhattanRoute(ax, ay, az, bx, by, bz, grid), maxLen);
}

export function isAxisAligned(path: ArrayLike<number>, eps = 1e-6): boolean {
  for (let i = 3; i < path.length; i += 3) {
    const dx = Math.abs(path[i]! - path[i - 3]!);
    const dy = Math.abs(path[i + 1]! - path[i - 2]!);
    const dz = Math.abs(path[i + 2]! - path[i - 1]!);
    const axes = (dx > eps ? 1 : 0) + (dy > eps ? 1 : 0) + (dz > eps ? 1 : 0);
    if (axes > 1) return false;
  }
  return true;
}

/** XZ vertices lie on `grid` lines (Y may be any altitude). */
export function isOnGridLines(
  path: ArrayLike<number>,
  grid: number = MAJOR_GRID,
  eps = 1e-6,
): boolean {
  for (let i = 0; i < path.length; i += 3) {
    const x = path[i]!;
    const z = path[i + 2]!;
    const sx = Math.abs(x - snapToGrid(x, grid));
    const sz = Math.abs(z - snapToGrid(z, grid));
    if (sx > eps || sz > eps) return false;
  }
  return true;
}

export interface TrafficEdge {
  a: number;
  b: number;
  kind: 'cluster' | 'extra' | 'trunk';
  path: number[];
}

function dist2(a: XzPoint, b: XzPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

class UnionFind {
  private readonly p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(i: number): number {
    let x = i;
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]!]!;
      x = this.p[x]!;
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.p[rb] = ra;
    return true;
  }
}

/**
 * Kruskal MST on XZ, then ~20% extra unused edges. `pick` is `rng.below`.
 * Returns index pairs; the caller builds Manhattan paths.
 */
export function clusterLinks(
  points: readonly XzPoint[],
  pick: (bound: number) => number,
  extraRatio = 0.2,
): { mst: Array<readonly [number, number]>; extra: Array<readonly [number, number]> } {
  const n = points.length;
  const mst: Array<readonly [number, number]> = [];
  const extra: Array<readonly [number, number]> = [];
  if (n < 2) return { mst, extra };
  const pairs: Array<{ a: number; b: number; d: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({ a: i, b: j, d: dist2(points[i]!, points[j]!) });
    }
  }
  pairs.sort((u, v) => u.d - v.d || u.a - v.a || u.b - v.b);
  const uf = new UnionFind(n);
  const used = new Set<string>();
  for (const e of pairs) {
    if (uf.union(e.a, e.b)) {
      mst.push([e.a, e.b]);
      used.add(`${e.a}:${e.b}`);
    }
  }
  const leftover = pairs.filter((e) => !used.has(`${e.a}:${e.b}`));
  const want = Math.round(mst.length * extraRatio);
  for (let k = 0; k < want && leftover.length > 0; k++) {
    const i = pick(leftover.length);
    const e = leftover.splice(i, 1)[0]!;
    extra.push([e.a, e.b]);
  }
  return { mst, extra };
}

export function nearestIndex(points: readonly XzPoint[], x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
