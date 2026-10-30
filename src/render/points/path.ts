import type { Vec3 } from '../../core/math/vec3';

/** Texels per row of the path DataTexture. Height grows with packed vertex count. */
export const PATH_TEX_WIDTH = 1024;

const EPS = 1e-8;

/**
 * RGBA32F path atlas (plan §8.5): xyz = vertex, w = cumulative arc length.
 * Paths are packed sequentially; each is closed so `fract` wrapping is C0.
 */
export interface PackedPaths {
  data: Float32Array;
  width: number;
  height: number;
  texelCount: number;
  starts: Int32Array;
  counts: Int32Array;
  lengths: Float32Array;
}

function isClosedFlag(closed: boolean | readonly boolean[], index: number): boolean {
  return typeof closed === 'boolean' ? closed : Boolean(closed[index] ?? true);
}

/**
 * Pack polylines (`[x,y,z] * n` each) into a path texture atlas.
 * Consecutive duplicate vertices are dropped. Open paths are closed with an
 * extra first-vertex texel so `t = fract(time*speed/len + offset)` loops.
 */
export function packPaths(
  paths: readonly ArrayLike<number>[],
  closed: boolean | readonly boolean[] = true,
): PackedPaths {
  const starts = new Int32Array(paths.length);
  const counts = new Int32Array(paths.length);
  const lengths = new Float32Array(paths.length);
  const vertLists: Array<{ x: number; y: number; z: number }>[] = [];
  let total = 0;

  for (let p = 0; p < paths.length; p++) {
    const src = paths[p]!;
    const n = Math.floor(src.length / 3);
    const verts: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < n; i++) {
      const x = src[i * 3]!;
      const y = src[i * 3 + 1]!;
      const z = src[i * 3 + 2]!;
      const prev = verts[verts.length - 1];
      if (prev && Math.hypot(x - prev.x, y - prev.y, z - prev.z) < EPS) continue;
      verts.push({ x, y, z });
    }
    if (verts.length === 0) verts.push({ x: 0, y: 0, z: 0 });
    if (verts.length === 1) verts.push({ ...verts[0]! });

    const first = verts[0]!;
    const last = verts[verts.length - 1]!;
    const alreadyClosed = Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < EPS;
    if (isClosedFlag(closed, p) && !alreadyClosed) verts.push({ ...first });
    else if (!alreadyClosed) verts.push({ ...first });

    vertLists.push(verts);
    total += verts.length;
  }

  const width = PATH_TEX_WIDTH;
  const height = Math.max(1, Math.ceil(Math.max(total, 1) / width));
  const data = new Float32Array(width * height * 4);
  let cursor = 0;

  for (let p = 0; p < vertLists.length; p++) {
    const verts = vertLists[p]!;
    starts[p] = cursor;
    counts[p] = verts.length;
    let cum = 0;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]!;
      if (i > 0) {
        const q = verts[i - 1]!;
        cum += Math.hypot(v.x - q.x, v.y - q.y, v.z - q.z);
      }
      const o = cursor * 4;
      data[o] = v.x;
      data[o + 1] = v.y;
      data[o + 2] = v.z;
      data[o + 3] = cum;
      cursor++;
    }
    lengths[p] = cum;
  }

  return { data, width, height, texelCount: cursor, starts, counts, lengths };
}

/** `t = fract(time * speed / len + offset)` (plan §8.5). */
export function trafficPhase(time: number, speed: number, length: number, offset: number): number {
  const len = length > 1e-8 ? length : 1;
  const x = time * (speed / len) + offset;
  return x - Math.floor(x);
}

/** Arc-length sample of a packed path. `t` wraps on [0, 1). Writes `out`. */
export function samplePath(packed: PackedPaths, pathIndex: number, t: number, out: Vec3): Vec3 {
  const start = packed.starts[pathIndex] ?? 0;
  const count = packed.counts[pathIndex] ?? 0;
  const len = packed.lengths[pathIndex] ?? 0;
  const data = packed.data;
  if (!(len > 0) || count < 2) {
    const o = start * 4;
    out.x = data[o] ?? 0;
    out.y = data[o + 1] ?? 0;
    out.z = data[o + 2] ?? 0;
    return out;
  }
  let u = t - Math.floor(t);
  if (u < 0) u += 1;
  const s = u * len;
  let lo = start;
  let hi = start + count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((data[mid * 4 + 3] ?? 0) <= s) lo = mid;
    else hi = mid;
  }
  const a = lo * 4;
  const b = Math.min(lo + 1, start + count - 1) * 4;
  const span = Math.max((data[b + 3] ?? 0) - (data[a + 3] ?? 0), 1e-8);
  const f = Math.min(1, Math.max(0, (s - (data[a + 3] ?? 0)) / span));
  const ax = data[a] ?? 0;
  const ay = data[a + 1] ?? 0;
  const az = data[a + 2] ?? 0;
  out.x = ax + ((data[b] ?? 0) - ax) * f;
  out.y = ay + ((data[b + 1] ?? 0) - ay) * f;
  out.z = az + ((data[b + 2] ?? 0) - az) * f;
  return out;
}

/** Largest |sample(joint) - vertex| over interior joints. 0 means no position jump. */
export function maxJointError(packed: PackedPaths): number {
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  let maxErr = 0;
  for (let p = 0; p < packed.starts.length; p++) {
    const start = packed.starts[p]!;
    const count = packed.counts[p]!;
    const len = packed.lengths[p]!;
    if (!(len > 0) || count < 3) continue;
    for (let i = 1; i < count - 1; i++) {
      const s = packed.data[(start + i) * 4 + 3]!;
      samplePath(packed, p, s / len, tmp);
      const o = (start + i) * 4;
      const dx = tmp.x - packed.data[o]!;
      const dy = tmp.y - packed.data[o + 1]!;
      const dz = tmp.z - packed.data[o + 2]!;
      const err = Math.hypot(dx, dy, dz);
      if (err > maxErr) maxErr = err;
    }
  }
  return maxErr;
}
