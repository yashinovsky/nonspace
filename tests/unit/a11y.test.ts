import { afterEach, describe, expect, it } from 'vitest';
import {
  WIDER_TOLERANCE_MUL,
  SLOWER_REKEY_MUL,
  iceAssistMods,
  mergeIceMods,
} from '../../src/a11y/assists';
import { formatCue, formatSpeech, SFX_CUES } from '../../src/a11y/speech';
import { openSettings, setSettingsOpener } from '../../src/a11y/host';
import { defaultSettings } from '../../src/core/settings';

describe('a11y speech', () => {
  it('formats speech and SFX cues', () => {
    expect(formatSpeech('dixie', 'three-two')).toBe('DIXIE> three-two');
    expect(formatSpeech('  ', 'hi')).toBe('SYSTEM> hi');
    expect(formatCue('rekey')).toBe('[REKEY]');
    expect(formatCue('[rekey]')).toBe('[REKEY]');
    expect(SFX_CUES.rekey).toBe('[REKEY]');
    expect(SFX_CUES.pain).toBe('[PAIN]');
    expect(SFX_CUES.grip).toBe('[GRIP]');
    expect(SFX_CUES.flatline).toBe('[FLATLINE]');
  });
});

describe('a11y Phase Lock assists', () => {
  it('widens tolerance and slows re-key from settings', () => {
    const off = iceAssistMods(defaultSettings().phaseLock);
    expect(off.tolMul).toBe(1);
    expect(off.rekeyMul).toBe(1);
    const on = iceAssistMods({
      ...defaultSettings().phaseLock,
      widerTolerance: true,
      slowerRekey: true,
    });
    expect(on.tolMul).toBe(WIDER_TOLERANCE_MUL);
    expect(on.rekeyMul).toBe(SLOWER_REKEY_MUL);
  });

  it('multiplies assists on top of soft mods', () => {
    const merged = mergeIceMods(
      { freezeDrift: true, feedbackMul: 0.3, traceMul: 0.5, tolMul: 2, rekeyMul: 1.5 },
      { ...defaultSettings().phaseLock, widerTolerance: true, slowerRekey: true },
    );
    expect(merged.freezeDrift).toBe(true);
    expect(merged.feedbackMul).toBe(0.3);
    expect(merged.traceMul).toBe(0.5);
    expect(merged.tolMul).toBeCloseTo(2 * WIDER_TOLERANCE_MUL);
    expect(merged.rekeyMul).toBeCloseTo(1.5 * SLOWER_REKEY_MUL);
  });
});

describe('a11y settings host', () => {
  afterEach(() => {
    setSettingsOpener(null);
  });

  it('opens immediately when an opener is installed', () => {
    let n = 0;
    setSettingsOpener(() => {
      n += 1;
    });
    openSettings();
    expect(n).toBe(1);
  });

  it('replays a pending open after the overlay loads', () => {
    let n = 0;
    openSettings();
    expect(n).toBe(0);
    setSettingsOpener(() => {
      n += 1;
    });
    expect(n).toBe(1);
    openSettings();
    expect(n).toBe(2);
  });
});
