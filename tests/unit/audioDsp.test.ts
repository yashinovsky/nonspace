import { describe, expect, it } from 'vitest';
import { tickAdsr } from '../../src/audio/dsp/adsr';
import { allocVoice, countActive, type VoiceSlot } from '../../src/audio/dsp/alloc';
import {
  applyFmMessage,
  createFmVoiceState,
  mixFmVoices,
  tickFmVoice,
} from '../../src/audio/dsp/fm';
import { dbToLinear, linearToDb } from '../../src/audio/dsp/gain';
import { createNoiseState, expSweep, tickNoise } from '../../src/audio/dsp/noise';
import { fmWorkletSource, FM_WORKLET_NAME } from '../../src/audio/worklets/fm.worklet';
import { noiseWorkletSource, NOISE_WORKLET_NAME } from '../../src/audio/worklets/noise.worklet';

describe('gain conversion', () => {
  it('maps dB to linear at the mix points we duck to', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 10);
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 4);
    expect(dbToLinear(-12)).toBeCloseTo(0.251189, 4);
    expect(dbToLinear(-24)).toBeCloseTo(0.063096, 4);
    expect(dbToLinear(-80)).toBe(0);
    expect(dbToLinear(-120)).toBe(0);
    expect(linearToDb(1)).toBeCloseTo(0, 10);
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('voice allocator', () => {
  const slots = (): VoiceSlot[] =>
    Array.from({ length: 16 }, () => ({ active: false, amp: 0, startedAt: 0 }));

  it('fills idle slots then steals the quietest', () => {
    const s = slots();
    for (let i = 0; i < 16; i++) {
      expect(allocVoice(s, i + 1)).toBe(i);
      s[i]!.amp = 1 - i * 0.01;
    }
    expect(countActive(s)).toBe(16);
    // Slot 15 has the lowest amp.
    expect(allocVoice(s, 99)).toBe(15);
  });

  it('steals the oldest when amps match', () => {
    const s = slots();
    for (let i = 0; i < 16; i++) {
      allocVoice(s, 10 + i);
      s[i]!.amp = 0.5;
    }
    expect(allocVoice(s, 100)).toBe(0);
  });
});

describe('ADSR', () => {
  it('reaches peak at the end of attack and idles after release', () => {
    const v = { stage: 1, env: 0, attack: 0.01, decay: 0.01, sustain: 0.5, release: 0.01 };
    const sr = 48000;
    const attackN = Math.round(0.01 * sr) + 2;
    for (let i = 0; i < attackN; i++) tickAdsr(v, sr);
    expect(v.env).toBeGreaterThan(0.95);
    expect(v.stage).toBeGreaterThanOrEqual(2);
    v.stage = 4;
    // Release is exponential (env -= env / (R*sr)), so it needs several time-constants.
    for (let i = 0; i < sr * 0.2; i++) tickAdsr(v, sr);
    expect(v.stage).toBe(0);
    expect(v.env).toBe(0);
  });
});

describe('FM voice', () => {
  it('is silent until noteOn, then produces a 2-op signal', () => {
    const v = createFmVoiceState();
    expect(tickFmVoice(v, 48000)).toBe(0);
    applyFmMessage([v], { type: 'on', i: 0, freq: 440, amp: 0.5, index: 0, attack: 0.001 });
    const sr = 48000;
    const left = new Float32Array(512);
    const right = new Float32Array(512);
    mixFmVoices([v], left, right, sr);
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]!));
    expect(peak).toBeGreaterThan(0.05);
    expect(v.stage).toBeGreaterThan(0);
  });

  it('allOff sends every live voice into release', () => {
    const voices = [createFmVoiceState(), createFmVoiceState()];
    applyFmMessage(voices, { type: 'on', i: 0, freq: 220 });
    applyFmMessage(voices, { type: 'on', i: 1, freq: 330 });
    applyFmMessage(voices, { type: 'allOff' });
    expect(voices[0]!.stage).toBe(4);
    expect(voices[1]!.stage).toBe(4);
  });
});

describe('noise', () => {
  it('stays in [-1, 1] and is deterministic for a seed', () => {
    const a = createNoiseState(12345, 0);
    const b = createNoiseState(12345, 0);
    for (let i = 0; i < 1000; i++) {
      const sa = tickNoise(a);
      const sb = tickNoise(b);
      expect(sa).toBe(sb);
      expect(sa).toBeGreaterThanOrEqual(-1);
      expect(sa).toBeLessThanOrEqual(1);
    }
  });

  it('expSweep hits the endpoints', () => {
    expect(expSweep(150, 38, 0, 0.15)).toBe(150);
    expect(expSweep(150, 38, 0.15, 0.15)).toBe(38);
    expect(expSweep(150, 38, 0.075, 0.15)).toBeCloseTo(Math.sqrt(150 * 38), 5);
  });
});

describe('worklet source', () => {
  it('embeds the DSP and registers classic processors', () => {
    const fm = fmWorkletSource();
    expect(fm).toContain(`registerProcessor('${FM_WORKLET_NAME}'`);
    expect(fm).toContain('AudioWorkletProcessor');
    expect(fm).toContain('fmApi.mixFmVoices');
    expect(fm).toContain('createFmVoiceState');
    const noise = noiseWorkletSource();
    expect(noise).toContain(`registerProcessor('${NOISE_WORKLET_NAME}'`);
    expect(noise).toContain('tickNoise');
  });
});
