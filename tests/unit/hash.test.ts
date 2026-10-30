import { describe, expect, it } from 'vitest';
import {
  hash1i,
  hash2i,
  hash32,
  hash3i,
  hashCombine,
  hashString,
  hashToUnit,
} from '../../src/core/hash';

const hex = (n: number): string => `0x${n.toString(16).padStart(8, '0')}`;

describe('integer hashing', () => {
  // Golden values: if these change, every generated sector changes. Bump the world seed version instead.
  it('produces pinned golden values', () => {
    expect(
      [
        hash32(0),
        hash32(1),
        hash32(0xffffffff),
        hash1i(5, 1),
        hash2i(0, 0, 0),
        hash2i(1, 0, 0),
        hash2i(0, 1, 0),
        hash2i(-3, 7, 1234),
        hash2i(511, 255, 42),
        hash3i(1, 2, 3, 4),
        hashString(''),
        hashString('straylight'),
        hashString('chiba-node', 9),
      ].map(hex),
    ).toEqual([
      '0x00000000',
      '0x688990c0',
      '0x6768824a',
      '0xd226269f',
      '0x58819ea1',
      '0x666fd240',
      '0x8efe04a8',
      '0x15b3c24c',
      '0xc0a9dcbb',
      '0xfbcaead3',
      '0x74141c20',
      '0xed3ab098',
      '0xdcc49e9e',
    ]);
  });

  it('returns uint32 and is order-sensitive', () => {
    const h = hash2i(-100, 200, 7);
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    expect(hash2i(3, 4, 0)).not.toBe(hash2i(4, 3, 0));
    expect(hash2i(3, 4, 0)).not.toBe(hash2i(3, 4, 1));
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });

  it('truncates fractional inputs to integers', () => {
    expect(hash2i(3.9, -2.2, 1)).toBe(hash2i(3, -2, 1));
  });

  it('has no collisions over the full sector grid', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 512; x++) for (let z = 0; z < 256; z++) seen.add(hash2i(x, z, 42));
    // 131,072 inputs into 2^32 buckets: expect ~2 birthday collisions at most.
    expect(seen.size).toBeGreaterThan(512 * 256 - 8);
  });

  it('avalanches: flipping one input bit flips about half the output bits', () => {
    let flipped = 0;
    let trials = 0;
    for (let x = 0; x < 256; x++) {
      const base = hash2i(x, 17, 99);
      for (let bit = 0; bit < 31; bit++) {
        const diff = (base ^ hash2i(x ^ (1 << bit), 17, 99)) >>> 0;
        let c = 0;
        for (let d = diff; d; d &= d - 1) c++;
        flipped += c;
        trials++;
      }
    }
    expect(flipped / trials).toBeGreaterThan(15);
    expect(flipped / trials).toBeLessThan(17);
  });

  it('hashToUnit maps to [0, 1)', () => {
    expect(hashToUnit(0)).toBe(0);
    expect(hashToUnit(0xffffffff)).toBeLessThan(1);
  });
});
