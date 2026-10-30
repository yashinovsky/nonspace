import { describe, expect, it } from 'vitest';
import { Pcg32, pcg32 } from '../../src/core/rng';

/** Straightforward BigInt PCG32 used only as an independent oracle. */
function referencePcg32(seed: bigint, stream: bigint): () => number {
  const mask = (1n << 64n) - 1n;
  const mul = 6364136223846793005n;
  const inc = ((stream << 1n) | 1n) & mask;
  let state = 0n;
  const next = (): number => {
    const old = state;
    state = (old * mul + inc) & mask;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  };
  next();
  state = (state + (seed & mask)) & mask;
  next();
  return next;
}

const hex = (n: number): string => `0x${n.toString(16).padStart(8, '0')}`;

describe('PCG32', () => {
  it('matches the reference pcg32-demo vectors (seed 42, stream 54)', () => {
    const rng = new Pcg32(42, 54);
    const out = Array.from({ length: 6 }, () => hex(rng.nextU32()));
    expect(out).toEqual([
      '0xa15c02b7',
      '0x7b47f409',
      '0xba1d3330',
      '0x83d2f293',
      '0xbfa4784b',
      '0xcbed606e',
    ]);
  });

  it('matches the reference bounded and float outputs from pcg32-demo', () => {
    // pcg32-demo round 1: "Coins" use boundedrand(2), "Rolls" boundedrand(6) + 1.
    const rng = new Pcg32(42, 54);
    for (let i = 0; i < 6; i++) rng.nextU32();
    const coins = Array.from({ length: 65 }, () => (rng.below(2) ? 'H' : 'T')).join('');
    expect(coins).toBe('HHTTTHTHHHTHTTTHHHHHTTTHHHTHTHTHTTHTTTHHHHHHTTTTHHTTTTTHTTTTTTTHT');
    const rolls = Array.from({ length: 33 }, () => rng.below(6) + 1).join(' ');
    expect(rolls).toBe('3 4 1 1 2 2 3 2 4 3 2 4 3 3 5 2 3 1 3 1 5 1 4 1 5 6 4 6 6 2 6 3 3');
  });

  it('agrees with an independent BigInt implementation across seeds and streams', () => {
    const cases: Array<[bigint, bigint]> = [
      [0n, 0n],
      [1n, 1n],
      [0xffffffffn, 0n],
      [0x1_0000_0000n, 7n],
      [0xdeadbeefcafebaben, 0x123456789abcdefn],
      [(1n << 64n) - 1n, (1n << 63n) - 1n],
    ];
    for (const [seed, stream] of cases) {
      const ours = new Pcg32(seed, stream);
      const ref = referencePcg32(seed, stream);
      for (let i = 0; i < 1000; i++) expect(ours.nextU32()).toBe(ref());
    }
  });

  it('is deterministic for a seed and differs across seeds and streams', () => {
    const a = Array.from(
      { length: 16 },
      (
        (r) => () =>
          r.nextU32()
      )(pcg32(1234)),
    );
    const b = Array.from(
      { length: 16 },
      (
        (r) => () =>
          r.nextU32()
      )(pcg32(1234)),
    );
    const c = Array.from(
      { length: 16 },
      (
        (r) => () =>
          r.nextU32()
      )(pcg32(1235)),
    );
    const d = Array.from(
      { length: 16 },
      (
        (r) => () =>
          r.nextU32()
      )(pcg32(1234, 1)),
    );
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).not.toEqual(d);
  });

  it('treats number and bigint seeds identically, including values above 2^32', () => {
    expect(new Pcg32(2 ** 40 + 5).nextU32()).toBe(new Pcg32(2n ** 40n + 5n).nextU32());
    expect(new Pcg32(-1).nextU32()).toBe(new Pcg32((1n << 64n) - 1n).nextU32());
    expect(() => new Pcg32(Number.NaN)).toThrow(RangeError);
  });

  it('round-trips state and clones independently', () => {
    const rng = pcg32(99);
    rng.nextU32();
    const saved = rng.getState();
    const clone = rng.clone();
    const expected = [rng.nextU32(), rng.nextU32()];
    expect([clone.nextU32(), clone.nextU32()]).toEqual(expected);
    rng.setState(saved);
    expect([rng.nextU32(), rng.nextU32()]).toEqual(expected);
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it('advance() skips ahead and back exactly', () => {
    const stepped = pcg32(7, 3);
    for (let i = 0; i < 1000; i++) stepped.nextU32();
    const jumped = pcg32(7, 3).advance(1000);
    expect(jumped.nextU32()).toBe(stepped.nextU32());
    jumped.advance(-1);
    stepped.advance(-1);
    expect(jumped.nextU32()).toBe(stepped.nextU32());
  });

  it('keeps helpers in range', () => {
    const rng = pcg32(5);
    for (let i = 0; i < 2000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
      expect(Number.isInteger(n)).toBe(true);
    }
    expect(() => rng.below(0)).toThrow(RangeError);
    expect(() => rng.int(2, 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(rng.poisson(0)).toBe(0);
  });

  it('distributes below() roughly uniformly', () => {
    const rng = pcg32(2024);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[rng.below(10)]!++;
    let chi2 = 0;
    for (const b of buckets) chi2 += (b - n / 10) ** 2 / (n / 10);
    // 9 degrees of freedom: p = 0.001 critical value is 27.9.
    expect(chi2).toBeLessThan(27.9);
  });

  it('poisson() has the requested mean', () => {
    const rng = pcg32(31337);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += rng.poisson(3.2);
    expect(sum / n).toBeCloseTo(3.2, 1);
  });

  it('shuffle() is a deterministic permutation', () => {
    const a = pcg32(3).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = pcg32(3).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
