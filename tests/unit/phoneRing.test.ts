import { describe, expect, it } from 'vitest';
import {
  PHONE_CYCLE,
  PHONE_ON_A,
  PHONE_TONE_A,
  PHONE_TONE_B,
  createPhoneRing,
  phoneFlashHz,
  phoneSounding,
} from '../../src/meat/phoneRing';

describe('payphone cadence', () => {
  it('rings twice per 3 s cycle, under 3 Hz', () => {
    expect(PHONE_CYCLE).toBeCloseTo(3);
    expect(phoneFlashHz()).toBeLessThan(3);
    expect(phoneSounding(0)).toBe(true);
    expect(phoneSounding(PHONE_ON_A + 0.05)).toBe(false);
    expect(phoneSounding(0.7)).toBe(true);
    expect(phoneSounding(1.5)).toBe(false);
    expect(phoneSounding(3.05)).toBe(true);
  });

  it('uses the UK dual-tone pair', () => {
    expect(PHONE_TONE_A).toBe(400);
    expect(PHONE_TONE_B).toBe(450);
  });

  it('is silent until start(), then follows sounding(t)', () => {
    const hook = createPhoneRing();
    expect(hook.playing).toBe(false);
    expect(hook.sounding(0)).toBe(false);
    hook.start();
    expect(hook.playing).toBe(true);
    expect(hook.sounding(0)).toBe(true);
    expect(hook.sounding(1.5)).toBe(false);
    hook.stop();
    expect(hook.playing).toBe(false);
    expect(hook.sounding(0)).toBe(false);
  });
});
