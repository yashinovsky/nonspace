import { describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../src/bot/HumanProxy';
import { runTry } from '../src/bot/runTry';
import { getDifficulty, getIce } from '../src/breach/presets';

describe('scripted player', () => {
  it('cracks white ICE every time, slower than the lock time', () => {
    for (let i = 0; i < 20; i++) {
      const r = runTry(getIce('white-1'), getDifficulty('normal'), BOT_PROFILES.average, 100 + i);
      expect(r.status).toBe('cracked');
      expect(r.time).toBeGreaterThan(getIce('white-1').layer.lockTime);
    }
  });

  it('separates skill levels on black ICE', () => {
    const med = (p: keyof typeof BOT_PROFILES) => {
      const ts = Array.from({ length: 40 }, (_, i) => runTry(getIce('black-1'), getDifficulty('normal'), BOT_PROFILES[p], 500 + i))
        .map((r) => (r.status === 'cracked' ? r.time : 999))
        .sort((a, b) => a - b);
      return ts[20];
    };
    expect(med('skilled')).toBeLessThan(med('average'));
    expect(med('average')).toBeLessThan(med('novice'));
  });

  it('is reproducible for a seed', () => {
    const a = runTry(getIce('gray-3'), getDifficulty('hard'), BOT_PROFILES.novice, 42);
    const b = runTry(getIce('gray-3'), getDifficulty('hard'), BOT_PROFILES.novice, 42);
    expect(a).toEqual(b);
  });
});
