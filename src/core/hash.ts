/**
 * Integer hashing for deterministic generation (plan §8.2, §8.6). Everything
 * is uint32 arithmetic via Math.imul, so results are identical in every
 * browser. Inputs are coerced to int32 (fractions truncated, wraps mod 2^32);
 * quantize world positions to the grid before hashing them.
 */

const GOLDEN = 0x9e3779b9;

/** Bijective uint32 finalizer (Wellons' "lowbias32"). */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Mix `value` into running hash `h`. Order-sensitive. */
export function hashCombine(h: number, value: number): number {
  return hash32((h ^ Math.imul((value | 0) + GOLDEN, 0x85ebca6b)) >>> 0);
}

/** Hash of one integer and a seed. */
export function hash1i(x: number, seed = 0): number {
  return hashCombine(hash32(seed >>> 0), x);
}

/** `hash2i(x, z, seed)` from plan §8.2: e.g. sector coordinates to a PCG32 seed. */
export function hash2i(x: number, z: number, seed = 0): number {
  return hashCombine(hashCombine(hash32(seed >>> 0), x), z);
}

export function hash3i(x: number, y: number, z: number, seed = 0): number {
  return hashCombine(hashCombine(hashCombine(hash32(seed >>> 0), x), y), z);
}

/** Stable uint32 hash of a string (UTF-16 code units, FNV-1a then finalized), e.g. landmark ids to seeds. */
export function hashString(s: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return hash32(h >>> 0);
}

/** Map a uint32 hash to a float in [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 0x1_0000_0000;
}
