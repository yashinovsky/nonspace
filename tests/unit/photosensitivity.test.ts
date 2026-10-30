import { describe, expect, it } from 'vitest';
import {
  MAX_FLASHES_PER_SEC,
  assertFlashRule,
  auditSequences,
  countFlashes,
} from '../../src/a11y/photosensitivity';

describe('M8.1 photosensitivity audit', () => {
  it('counts rising edges above the large-area threshold', () => {
    expect(countFlashes([0, 0.2, 0.2, 0.05, 0.3])).toBe(2);
    expect(countFlashes([0, 0.05, 0.05])).toBe(0);
  });

  it('every authored sequence stays ≤ 3 flashes/s with Reduce flashing on', () => {
    const rows = auditSequences(true, true);
    expect(rows.map((r) => r.id)).toEqual([
      'jack-in-full',
      'jack-in-short',
      'jack-out',
      'simstim-flip',
      'jump-streak',
      'ice-telegraph',
      'teletext-flash',
      'trace-bargraph',
      'title-prompt',
      'merge',
    ]);
    const failed = assertFlashRule(rows);
    expect(failed.map((r) => `${r.id}:${r.flashesPerSec.toFixed(2)}`)).toEqual([]);
    for (const row of rows) {
      expect(row.flashesPerSec).toBeLessThanOrEqual(MAX_FLASHES_PER_SEC);
    }
  });
});
