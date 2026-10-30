import { describe, expect, it } from 'vitest';
import { createNoopAudioEngine, type AudioEngine } from '../../src/audio/AudioEngine';
import { BOOT_DURATION, BOOT_STEPS, sampleBoot } from '../../src/app/modes/Boot';
import { createTitleMode, isTitleUnlockKey } from '../../src/app/modes/Title';

describe('M3.3 boot POST', () => {
  it('emits ROM/RAM checks then READY', () => {
    expect(sampleBoot(0).lines[0]).toMatch(/ONO-SENDAI/);
    expect(sampleBoot(0).done).toBe(false);
    const mid = sampleBoot(0.6);
    expect(mid.lines.some((l) => l.includes('ROM'))).toBe(true);
    expect(mid.lines.some((l) => l.includes('RAM'))).toBe(true);
    const end = sampleBoot(BOOT_DURATION);
    expect(end.done).toBe(true);
    expect(end.lines.at(-1)).toBe('READY.');
    expect(BOOT_STEPS.length).toBeGreaterThan(6);
  });
});

describe('M3.3 title unlock', () => {
  it('pressing a key calls audio.unlock()', async () => {
    expect(isTitleUnlockKey(' ')).toBe(true);
    expect(isTitleUnlockKey('Shift')).toBe(false);
    let calls = 0;
    const inner = createNoopAudioEngine();
    const audio: AudioEngine = {
      ...inner,
      unlock: async () => {
        calls += 1;
        return inner.unlock();
      },
    };
    const title = createTitleMode({ audio });
    title.pressKey('Shift');
    expect(calls).toBe(0);
    title.pressKey(' ');
    expect(calls).toBe(1);
    expect(title.unlocked).toBe(true);
    expect(title.unlockCalls).toBe(1);
    title.pressKey('Enter');
    expect(calls).toBe(1);
  });
});
