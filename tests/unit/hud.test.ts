import { describe, expect, it } from 'vitest';
import { eegSample, eegVariance, EEG_SAMPLES } from '../../src/hud/EegTrace';
import { layoutHud } from '../../src/hud/Hud';
import {
  TRACE_BLINK_FROM,
  TRACE_SEGMENTS,
  traceBlink,
  traceColor,
  traceLitCount,
} from '../../src/hud/Bargraph';
import { createTerminal, TERMINAL_CHARS_PER_SEC } from '../../src/hud/Terminal';
import { padHud3 } from '../../src/hud/VfdStrip';
import { radarSweepAngle, RADAR_SWEEP_HZ } from '../../src/hud/Radar';
import { Beam } from '../../src/render/lines/BeamBatch';
import { createPalette } from '../../src/render/palette';

function fillEeg(neural: number, flatline: boolean, t0 = 1): Float32Array {
  const s = new Float32Array(EEG_SAMPLES);
  for (let i = 0; i < EEG_SAMPLES; i++) {
    s[i] = eegSample(t0 + i / 60, neural / 100, flatline, 1);
  }
  return s;
}

describe('M3.2 HUD layout', () => {
  it('keeps reticle centered and chrome anchored at 16:9, 21:9 and 4:3', () => {
    const a = layoutHud(1920, 1080);
    const b = layoutHud(2520, 1080);
    const c = layoutHud(1440, 1080);
    expect(a.aspect).toBeCloseTo(16 / 9, 5);
    expect(b.aspect).toBeCloseTo(21 / 9, 5);
    expect(c.aspect).toBeCloseTo(4 / 3, 5);

    for (const L of [a, b, c]) {
      expect(L.reticle.x).toBeCloseTo(L.width / 2, 5);
      expect(L.reticle.y).toBeCloseTo(L.height / 2, 5);
      expect(L.radar.x).toBeGreaterThan(L.width * 0.55);
      expect(L.radar.y + L.radar.h).toBeGreaterThan(L.height * 0.75);
      expect(L.pip.x + L.pip.w).toBeLessThanOrEqual(L.width - L.margin + 0.1);
      expect(L.pip.x).toBeGreaterThan(L.radar.x);
      expect(L.strip.y).toBeLessThan(L.height * 0.2);
      expect(L.terminal.y).toBeGreaterThan(L.height * 0.7);
      expect(L.terminal.x + L.terminal.w).toBeLessThanOrEqual(L.radar.x + 8);
      expect(L.periscope.tl.x).toBeLessThan(L.width * 0.3);
      expect(L.periscope.tr.x).toBeGreaterThan(L.width * 0.7);
    }
    expect(b.radar.x).toBeGreaterThan(a.radar.x);
    expect(c.radar.w).toBeLessThanOrEqual(a.radar.w + 1);
  });
});

describe('M3.2 EEG', () => {
  it('morphs calm → ragged → flat across neural 0–100 and flatline', () => {
    const calm = fillEeg(0, false);
    const mid = fillEeg(50, false);
    const ragged = fillEeg(100, false);
    const flat = fillEeg(100, true);
    const vCalm = eegVariance(calm, EEG_SAMPLES);
    const vMid = eegVariance(mid, EEG_SAMPLES);
    const vRag = eegVariance(ragged, EEG_SAMPLES);
    const vFlat = eegVariance(flat, EEG_SAMPLES);
    expect(vCalm).toBeGreaterThan(0.01);
    expect(vRag).toBeGreaterThan(vCalm);
    expect(vMid).toBeGreaterThan(vCalm * 0.5);
    expect(vMid).toBeLessThan(vRag * 1.8);
    expect(vFlat).toBeLessThan(0.01);
    let maxFlat = 0;
    for (let i = 0; i < flat.length; i++) maxFlat = Math.max(maxFlat, Math.abs(flat[i]!));
    expect(maxFlat).toBeLessThan(0.2);
  });

  it('is deterministic (no Math.random)', () => {
    expect(eegSample(1.25, 0.4, false, 2)).toBe(eegSample(1.25, 0.4, false, 2));
    expect(eegSample(1.25, 0.4, true, 2)).not.toBe(eegSample(1.25, 0.4, false, 2));
  });
});

describe('M3.2 terminal baud', () => {
  it('prints at 120 chars/s and Wintermute is instant', () => {
    expect(TERMINAL_CHARS_PER_SEC).toBe(120);
    const term = createTerminal(createPalette());
    term.print('ABCDEFGHIJ');
    term.update(0, 0);
    expect(term.visible).toBe('');
    term.update(1 / 120, 0);
    expect(term.visible).toBe('A');
    term.update(4 / 120, 0);
    expect(term.visible).toBe('ABCDE');
    term.print('WINTERMUTE> HELLO COWBOY', { wintermute: true });
    expect(term.visible).toBe('WINTERMUTE> HELLO COWBOY');
    expect(term.pending).toBe(0);
    term.dispose();
  });
});

describe('M3.2 trace bargraph', () => {
  it('fills 10 LEDs green→amber→red and blinks the last at ≥90%', () => {
    expect(TRACE_SEGMENTS).toBe(10);
    expect(traceLitCount(0)).toBe(0);
    expect(traceLitCount(1)).toBe(10);
    expect(traceLitCount(0.34)).toBe(3);
    expect(traceColor(0)).toBe(Beam.MITSU);
    expect(traceColor(5)).toBe(Beam.AMBER);
    expect(traceColor(8)).toBe(Beam.ESFA);
    expect(TRACE_BLINK_FROM).toBeCloseTo(0.9);
    expect(traceBlink(0.5, 0.1, false)).toBe(1);
    const on = traceBlink(0.95, 0.0, false);
    const off = traceBlink(0.95, 0.3, false);
    expect(on).not.toBe(off);
    expect(traceBlink(0.95, 0.1, true)).toBe(0.7);
  });
});

describe('M3.2 radar + VFD helpers', () => {
  it('sweeps at 0.5 Hz and pads three-digit VFD fields', () => {
    expect(RADAR_SWEEP_HZ).toBeCloseTo(0.5);
    expect(radarSweepAngle(0)).toBeCloseTo(0);
    expect(radarSweepAngle(1)).toBeCloseTo(Math.PI);
    expect(radarSweepAngle(2)).toBeCloseTo(0);
    expect(padHud3(80)).toBe('080');
    expect(padHud3(7)).toBe('007');
  });
});
