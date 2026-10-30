import { describe, expect, it } from 'vitest';
import {
  BELL103,
  EXTRA_SFX_IDS,
  FLATLINE_TIMING,
  SFX_BOUND_EVENTS,
  SFX_IDS,
  SFX_PALETTE,
  barkPlan,
  bindSfxToEvents,
  bitDuration,
  extraSfxCount,
  fillBits,
  flatlinePhaseAt,
  fskFreq,
  handshakeTimeline,
  laughPlan,
  paletteCoversEveryRecipe,
} from '../../src/audio/AudioEngine';
import { degreeHz, MODE_DEGREES } from '../../src/audio/sfx/pitch';
import { createEventBus } from '../../src/core/events';
import { createRecordingAudioEngine } from '../../src/testing/mocks';

describe('§7.3 palette coverage', () => {
  it('lists all 17 recipes and every SfxId is playable', () => {
    expect(SFX_PALETTE).toHaveLength(17);
    expect(paletteCoversEveryRecipe()).toBe(true);
    const paletteIds = new Set<string>(SFX_PALETTE.map((row) => row.id));
    expect(paletteIds.has('flightWind')).toBe(true);
    for (const id of SFX_IDS) {
      expect(paletteIds.has(id) || (EXTRA_SFX_IDS as readonly string[]).includes(id)).toBe(true);
    }
    expect(extraSfxCount()).toBe(EXTRA_SFX_IDS.length);
    expect(new Set(SFX_IDS).size).toBe(SFX_IDS.length);
  });
});

describe('flatline timing (visual lock)', () => {
  it('walks beeps → tone → linger → silence over 4 s', () => {
    expect(FLATLINE_TIMING.total).toBe(4);
    expect(FLATLINE_TIMING.toneHz).toBe(1000);
    expect(FLATLINE_TIMING.lingerDur).toBe(2);
    expect(flatlinePhaseAt(-1)).toBe('idle');
    expect(flatlinePhaseAt(0)).toBe('beeps');
    expect(flatlinePhaseAt(FLATLINE_TIMING.toneStart - 0.01)).toBe('beeps');
    expect(flatlinePhaseAt(FLATLINE_TIMING.toneStart)).toBe('tone');
    expect(flatlinePhaseAt(FLATLINE_TIMING.toneStart + FLATLINE_TIMING.collapseDur)).toBe('linger');
    expect(flatlinePhaseAt(FLATLINE_TIMING.silenceAt)).toBe('silence');
    expect(flatlinePhaseAt(FLATLINE_TIMING.total)).toBe('done');
    expect(FLATLINE_TIMING.beepStarts).toHaveLength(FLATLINE_TIMING.beepCount);
    expect(FLATLINE_TIMING.silenceAt).toBeCloseTo(
      FLATLINE_TIMING.toneStart + FLATLINE_TIMING.collapseDur + FLATLINE_TIMING.lingerDur,
      5,
    );
  });
});

describe('Bell 103 FSK', () => {
  it('uses originate 1070/1270 and answer 2025/2225 at 300 baud', () => {
    expect(fskFreq('originate', 0)).toBe(1070);
    expect(fskFreq('originate', 1)).toBe(1270);
    expect(fskFreq('answer', 0)).toBe(2025);
    expect(fskFreq('answer', 1)).toBe(2225);
    expect(BELL103.baud).toBe(300);
    expect(bitDuration()).toBeCloseTo(1 / 300, 10);
    const tl = handshakeTimeline();
    expect(tl.dataAt).toBeGreaterThan(tl.chirpAt);
    expect(tl.answerCarrierAt).toBeGreaterThan(0);
  });

  it('fills deterministic bitstreams from a seed', () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    const c = new Uint8Array(32);
    fillBits(a, 1);
    fillBits(b, 1);
    fillBits(c, 2);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(a.every((bit) => bit === 0 || bit === 1)).toBe(true);
  });
});

describe('Dixie bark / laugh plans', () => {
  it('barks are deterministic per lineId and use the formant table', () => {
    const a = barkPlan('ice-read');
    const b = barkPlan('ice-read');
    const c = barkPlan('other');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.length).toBeLessThanOrEqual(6);
    for (const ph of a) {
      expect(ph.f0).toBeGreaterThan(50);
      expect(ph.dur).toBeGreaterThan(0.02);
    }
  });

  it('laugh has no inhale (tight gaps, falling amp)', () => {
    const bursts = laughPlan(0xabc);
    expect(bursts.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < bursts.length; i++) {
      const gap = bursts[i]!.start - (bursts[i - 1]!.start + bursts[i - 1]!.dur);
      expect(gap).toBeLessThan(0.09);
      expect(bursts[i]!.amp).toBeLessThan(bursts[i - 1]!.amp);
    }
  });
});

describe('in-key degrees', () => {
  it('maps mode degrees from a MIDI root', () => {
    expect(MODE_DEGREES.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(degreeHz(69, 'minor', 0)).toBeCloseTo(440, 8);
    expect(degreeHz(69, 'minor', 4)).toBeCloseTo(440 * Math.pow(2, 7 / 12), 8);
  });
});

describe('bindSfxToEvents', () => {
  it('routes §9.1 events onto sfx, modem, and Dixie without changing the bus contract', () => {
    const { engine, callsTo } = createRecordingAudioEngine();
    const bus = createEventBus();
    const barks: string[] = [];
    const off = bindSfxToEvents(bus, engine, {
      bark: (id) => barks.push(id),
      laugh: () => {},
      dispose: () => {},
    });

    bus.emit({ type: 'jackIn', missionId: 'm1' });
    bus.emit({ type: 'jackOut', reason: 'player' });
    bus.emit({ type: 'jackOut', reason: 'burned' });
    bus.emit({ type: 'flatline', scripted: true });
    bus.emit({ type: 'scanPulse', origin: { x: 1, y: 2, z: 3 } });
    bus.emit({ type: 'iceRekeyTelegraph', iceId: 'ice', inSeconds: 1 });
    bus.emit({ type: 'iceLayerCracked', iceId: 'ice', layer: 0 });
    bus.emit({ type: 'simstimFlip', on: true });
    bus.emit({ type: 'traceChanged', value: 12 });
    bus.emit({ type: 'downloadProgress', targetId: 't', value: 0.4 });
    bus.emit({ type: 'downloadProgress', targetId: 't', value: 1 });
    bus.emit({ type: 'dixieSay', lineId: 'hello-dixie' });
    bus.emit({ type: 'wintermute', action: { kind: 'hijack', text: 'hi' } });
    bus.emit({ type: 'wintermute', action: { kind: 'overexpose', amount: 0.2 } });
    bus.emit({ type: 'neuromancer', action: { kind: 'soften', amount: 0.5 } });

    expect(callsTo('sfx').map((c) => c.args[0])).toEqual([
      'jackIn',
      'jackOut',
      'burned',
      'flatline',
      'scan',
      'rekeyTelegraph',
      'shatter',
      'simstimFlip',
      'traceTick',
      'wintermuteHijack',
      'neuromancerSoften',
    ]);
    expect(callsTo('modem.start')).toHaveLength(1);
    expect(callsTo('modem.stop')).toHaveLength(1);
    expect(barks).toEqual(['hello-dixie']);
    expect(SFX_BOUND_EVENTS).toContain('flatline');
    off();
  });
});
