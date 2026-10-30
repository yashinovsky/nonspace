/**
 * PCG32 (pcg32_random_r: 64-bit LCG state, XSH-RR output) after O'Neill's
 * reference implementation. The 64-bit state is held as two uint32 halves so
 * stepping never allocates or touches BigInt. Use this for all generation;
 * `Math.random` is only for cosmetic noise (plan §8.2).
 */

const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;
const TWO_POW_32 = 0x1_0000_0000;

export interface Pcg32State {
  stateHi: number;
  stateLo: number;
  incHi: number;
  incLo: number;
}

export type Seed = number | bigint;

function toU64(value: Seed, what: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`PCG32 ${what} must be finite, got ${value}`);
    value = BigInt(Math.trunc(value));
  }
  return BigInt.asUintN(64, value);
}

export class Pcg32 {
  private hi = 0;
  private lo = 0;
  private incHi = 0;
  private incLo = 1;

  /** Same as `pcg32_srandom_r(seed, stream)`. Numbers are truncated to integers; negatives wrap mod 2^64. */
  constructor(seed: Seed = 0, stream: Seed = 0) {
    this.seed(seed, stream);
  }

  seed(seed: Seed, stream: Seed = 0): this {
    const inc = BigInt.asUintN(64, (toU64(stream, 'stream') << 1n) | 1n);
    const init = toU64(seed, 'seed');
    this.incHi = Number(inc >> 32n);
    this.incLo = Number(inc & 0xffffffffn);
    this.hi = 0;
    this.lo = 0;
    this.step();
    const lo = this.lo + Number(init & 0xffffffffn);
    this.lo = lo >>> 0;
    this.hi = (this.hi + Number(init >> 32n) + (lo >= TWO_POW_32 ? 1 : 0)) >>> 0;
    this.step();
    return this;
  }

  /** state = state * 6364136223846793005 + inc (mod 2^64). */
  private step(): void {
    const sh = this.hi;
    const sl = this.lo;
    // Full 64-bit product of the low halves, via 16-bit limbs (each partial product < 2^32).
    const a0 = sl & 0xffff;
    const a1 = sl >>> 16;
    const b0 = MUL_LO & 0xffff;
    const b1 = MUL_LO >>> 16;
    const p00 = a0 * b0;
    const p01 = a0 * b1;
    const p10 = a1 * b0;
    const p11 = a1 * b1;
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    const prodLo = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
    const prodHi = p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16);
    const hi = prodHi + Math.imul(sh, MUL_LO) + Math.imul(sl, MUL_HI);
    const lo = prodLo + this.incLo;
    this.lo = lo >>> 0;
    this.hi = (hi + this.incHi + (lo >= TWO_POW_32 ? 1 : 0)) >>> 0;
  }

  /** Uniform uint32. */
  nextU32(): number {
    const oh = this.hi;
    const ol = this.lo;
    this.step();
    // xorshifted = uint32(((old >> 18) ^ old) >> 27); rot = old >> 59
    const xh = oh ^ (oh >>> 18);
    const xl = ol ^ ((ol >>> 18) | (oh << 14));
    const x = ((xl >>> 27) | (xh << 5)) >>> 0;
    const rot = oh >>> 27;
    return ((x >>> rot) | (x << (-rot & 31))) >>> 0;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. */
  next(): number {
    return this.nextU32() / TWO_POW_32;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Unbiased uniform integer in [0, bound), bound in [1, 2^32]. Same as `pcg32_boundedrand_r`. */
  below(bound: number): number {
    if (!(bound >= 1 && bound <= TWO_POW_32) || !Number.isInteger(bound)) {
      throw new RangeError(`PCG32 bound must be an integer in [1, 2^32], got ${bound}`);
    }
    if (bound === TWO_POW_32) return this.nextU32();
    const threshold = (TWO_POW_32 - bound) % bound;
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) return r % bound;
    }
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`PCG32 int range is empty: [${min}, ${max}]`);
    return min + this.below(max - min + 1);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('PCG32 pick from an empty array');
    return items[this.below(items.length)]!;
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      const t = items[i]!;
      items[i] = items[j]!;
      items[j] = t;
    }
    return items;
  }

  /** Standard normal sample (Box–Muller; consumes two outputs). */
  normal(mean = 0, stdDev = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson sample (Knuth's method; intended for small means such as cluster counts). */
  poisson(mean: number): number {
    if (!(mean > 0)) return 0;
    const limit = Math.exp(-mean);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }

  /** Advance (or rewind, for negative delta) the stream by `delta` outputs in O(log delta). Same as `pcg32_advance_r`. */
  advance(delta: number | bigint): this {
    let d = BigInt.asUintN(64, BigInt(delta));
    let curMul = BigInt(MUL_HI) * 2n ** 32n + BigInt(MUL_LO);
    let curPlus = (BigInt(this.incHi) << 32n) | BigInt(this.incLo);
    let accMul = 1n;
    let accPlus = 0n;
    const mask = 0xffffffffffffffffn;
    while (d > 0n) {
      if (d & 1n) {
        accMul = (accMul * curMul) & mask;
        accPlus = (accPlus * curMul + curPlus) & mask;
      }
      curPlus = ((curMul + 1n) * curPlus) & mask;
      curMul = (curMul * curMul) & mask;
      d >>= 1n;
    }
    const state = (accMul * ((BigInt(this.hi) << 32n) | BigInt(this.lo)) + accPlus) & mask;
    this.hi = Number(state >> 32n);
    this.lo = Number(state & 0xffffffffn);
    return this;
  }

  getState(): Pcg32State {
    return { stateHi: this.hi, stateLo: this.lo, incHi: this.incHi, incLo: this.incLo };
  }

  setState(s: Pcg32State): this {
    this.hi = s.stateHi >>> 0;
    this.lo = s.stateLo >>> 0;
    this.incHi = s.incHi >>> 0;
    this.incLo = (s.incLo | 1) >>> 0;
    return this;
  }

  clone(): Pcg32 {
    return new Pcg32().setState(this.getState());
  }
}

/** `rng = pcg32(hash2i(sx, sz, seed))` (plan §8.6). */
export function pcg32(seed: Seed, stream: Seed = 0): Pcg32 {
  return new Pcg32(seed, stream);
}
