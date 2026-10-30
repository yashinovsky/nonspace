import { describe, expect, it } from 'vitest';
import {
  JUMP_STREAK_DECAY,
  JUMP_STREAK_DECAY_REDUCED,
  sampleJumpStreak,
} from '../../src/render/fx/JumpStreak';

describe('M2.6 jump streak sample', () => {
  it('idles at identity decay and kicks FOV during the streak', () => {
    const idle = sampleJumpStreak('idle', 0);
    expect(idle.decayScale).toBe(1);
    expect(idle.fovKick).toBe(0);
    expect(idle.streak).toBe(0);

    const mid = sampleJumpStreak('streak', 0.5);
    expect(mid.fovKick).toBeCloseTo(25, 5);
    expect(mid.decayScale).toBe(JUMP_STREAK_DECAY);
    expect(mid.decayScale).toBeLessThan(1);
    expect(mid.destGrow).toBeGreaterThan(0.5);
    expect(mid.streak).toBeCloseTo(1, 5);

    const reduced = sampleJumpStreak('streak', 0.5, true);
    expect(reduced.fovKick).toBeLessThan(mid.fovKick);
    expect(reduced.decayScale).toBe(JUMP_STREAK_DECAY_REDUCED);
    expect(reduced.decayScale).toBeGreaterThan(mid.decayScale);
  });
});
