import { describe, expect, it } from 'vitest';
import { createIceModel } from '../../src/breach/IceModel';
import { CORE_TRACE_MUL } from '../../src/breach/CoreInterior';
import { DISSONANCE_THRESHOLD } from '../../src/breach/PhaseLock';
import { GRAY_ICE } from '../../src/content/ice/gray';
import { DIFFICULTY, ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { WHITE_ICE } from '../../src/content/ice/white';
import { senseNetIce } from '../../src/content/missions/m2';
import { turingIce, turingRekeyScale } from '../../src/content/missions/m4';
import { straylightIce } from '../../src/content/missions/m5';
import {
  SENSE_NET_EXPOSURE_PER_SEC,
  SENSE_NET_GATE_EARLY,
  SENSE_NET_GATE_LATE,
} from '../../src/content/simstim/senseNet';
import {
  campaignTuneOpts,
  difficultyMul,
  GATE_WINDOWS,
  rekeyScale,
  resolveDifficulty,
  TRACE_RATES,
  tuneGateWindow,
  tuneGates,
  tuneIce,
  tuneLayer,
} from '../../src/content/tuning';
import { createEventBus } from '../../src/core/events';
import { HEAT_REKEY_PER_LEVEL } from '../../src/deck/Heat';
import { HULL_TRACE_RATE, TRACE_MAX } from '../../src/deck/Trace';
import { createGates, type GateDef } from '../../src/simstim/Gates';
import { WATCHER_TRACE_RATE } from '../../src/world/watchers/Watcher';

const DT = 1 / 60;

const SAMPLE_GATE: GateDef = {
  id: 'lobby-door',
  iceNode: 'sense-net-lobby',
  tMeat: 80,
  early: GATE_WINDOWS.early,
  late: GATE_WINDOWS.late,
  onEarly: [],
  onLate: [],
};

describe('§12.3 tuning tables', () => {
  it('keeps ICE presets on the Normal column', () => {
    expect(ICE_LAYER_PRESETS['white-1']).toMatchObject({
      ratios: [
        [1, 1],
        [1, 2],
      ],
      tolRatio: 0.1,
      phaseDrift: 0.1,
      telegraph: 0,
      lockTime: 2.0,
      traceRate: 0.6,
      feedbackDps: 0,
    });
    expect('rekeyEvery' in ICE_LAYER_PRESETS['white-1']).toBe(false);

    expect(ICE_LAYER_PRESETS['gray-2']).toMatchObject({
      ratios: [
        [1, 2],
        [2, 3],
        [3, 4],
      ],
      tolRatio: 0.07,
      phaseDrift: 0.25,
      rekeyEvery: [7, 10],
      telegraph: 1.2,
      lockTime: 2.5,
      traceRate: 1.0,
      feedbackDps: 3,
    });

    expect(ICE_LAYER_PRESETS['gray-3']).toMatchObject({
      ratios: [
        [2, 3],
        [3, 4],
        [3, 5],
        [4, 5],
      ],
      tolRatio: 0.06,
      phaseDrift: 0.35,
      rekeyEvery: [6, 8],
      telegraph: 1.0,
      lockTime: 2.5,
      traceRate: 1.2,
      feedbackDps: 4,
    });

    expect(ICE_LAYER_PRESETS['black-1']).toMatchObject({
      ratios: [
        [2, 3],
        [3, 5],
        [4, 5],
        [5, 6],
      ],
      tolRatio: 0.05,
      phaseDrift: 0.5,
      rekeyEvery: [4, 6],
      telegraph: 0.8,
      lockTime: 3.0,
      traceRate: 1.5,
      feedbackDps: 9,
      grip: { neuralThreshold: 60, seconds: 8 },
    });

    expect(ICE_LAYER_PRESETS['kuang-gate']).toMatchObject({
      ratios: [
        [1, 2],
        [2, 3],
        [3, 4],
      ],
      tolRatio: 0.12,
      phaseDrift: 0.2,
      telegraph: 0,
      lockTime: 1.2,
      traceRate: 0.8,
      feedbackDps: 2,
    });
    expect('rekeyEvery' in ICE_LAYER_PRESETS['kuang-gate']).toBe(false);
  });

  it('keeps Easy/Story, Normal, Hard multipliers', () => {
    expect(DIFFICULTY.story).toEqual({
      tolRatio: 1.6,
      rekeyInterval: 1.5,
      telegraph: 1.5,
      feedbackDps: 0.4,
      gateWindows: 1.5,
    });
    expect(DIFFICULTY.normal).toEqual({
      tolRatio: 1,
      rekeyInterval: 1,
      telegraph: 1,
      feedbackDps: 1,
      gateWindows: 1,
    });
    expect(DIFFICULTY.hard).toEqual({
      tolRatio: 0.8,
      rekeyInterval: 0.75,
      telegraph: 0.8,
      feedbackDps: 1.3,
      gateWindows: 0.75,
    });
    expect(resolveDifficulty('easy')).toBe('story');
    expect(difficultyMul('easy')).toEqual(DIFFICULTY.story);
  });

  it('keeps M2 gate windows and trace rates on the table', () => {
    expect(GATE_WINDOWS).toEqual({ early: 20, late: 15, exposurePerSec: 0.04, failAt: 1 });
    expect(SENSE_NET_GATE_EARLY).toBe(GATE_WINDOWS.early);
    expect(SENSE_NET_GATE_LATE).toBe(GATE_WINDOWS.late);
    expect(SENSE_NET_EXPOSURE_PER_SEC).toBe(GATE_WINDOWS.exposurePerSec);
    expect(TRACE_RATES).toEqual({
      hullContact: 2,
      watcherSweep: 6,
      coreInteriorMul: 1.5,
      burnedAt: 100,
    });
    expect(HULL_TRACE_RATE).toBe(TRACE_RATES.hullContact);
    expect(WATCHER_TRACE_RATE).toBe(TRACE_RATES.watcherSweep);
    expect(CORE_TRACE_MUL).toBe(TRACE_RATES.coreInteriorMul);
    expect(TRACE_MAX).toBe(TRACE_RATES.burnedAt);
  });
});

describe('difficulty and heat change numbers', () => {
  it('scales ICE layers and treats Easy as Story', () => {
    const base = ICE_LAYER_PRESETS['gray-2'];
    const story = tuneLayer(base, { difficulty: 'story' });
    const easy = tuneLayer(base, { difficulty: 'easy' });
    const hard = tuneLayer(base, { difficulty: 'hard' });
    expect(easy).toEqual(story);
    expect(story.tolRatio).toBeCloseTo(base.tolRatio * 1.6, 10);
    expect(hard.tolRatio).toBeCloseTo(base.tolRatio * 0.8, 10);
    expect(story.tolRatio).toBeGreaterThan(hard.tolRatio);
    expect(story.telegraph).toBeCloseTo(base.telegraph * 1.5, 10);
    expect(hard.telegraph).toBeCloseTo(base.telegraph * 0.8, 10);
    expect(story.feedbackDps).toBeCloseTo(base.feedbackDps * 0.4, 10);
    expect(hard.feedbackDps).toBeCloseTo(base.feedbackDps * 1.3, 10);
    expect(story.rekeyEvery![0]).toBeCloseTo(base.rekeyEvery![0] * 1.5, 10);
    expect(hard.rekeyEvery![0]).toBeCloseTo(base.rekeyEvery![0] * 0.75, 10);
    expect(story.phaseDrift).toBe(base.phaseDrift);
    expect(story.lockTime).toBe(base.lockTime);
  });

  it('shortens re-key when heat rises, stacked with Hard', () => {
    const base = ICE_LAYER_PRESETS['gray-2'].rekeyEvery!;
    const cold = tuneLayer(ICE_LAYER_PRESETS['gray-2'], { heat: 0 });
    const hot = tuneLayer(ICE_LAYER_PRESETS['gray-2'], { heat: 2 });
    const hardHot = tuneLayer(ICE_LAYER_PRESETS['gray-2'], { difficulty: 'hard', heat: 2 });
    expect(hot.rekeyEvery![0]).toBeLessThan(cold.rekeyEvery![0]);
    expect(cold.rekeyEvery![0] / hot.rekeyEvery![0]).toBeCloseTo(1 + HEAT_REKEY_PER_LEVEL * 2, 10);
    expect(hardHot.rekeyEvery![0]).toBeCloseTo(base[0] * rekeyScale('hard', 2), 10);
    expect(hardHot.rekeyEvery![0]).toBeLessThan(hot.rekeyEvery![0]);
    expect(turingRekeyScale(2, 'hard')).toBe(rekeyScale('hard', 2));
  });

  it('changes IceModel feedback and re-key timing measurably', () => {
    const story = createIceModel(tuneIce(GRAY_ICE, { difficulty: 'story' }), { seed: 3 });
    const hard = createIceModel(tuneIce(GRAY_ICE, { difficulty: 'hard' }), { seed: 3 });
    story.engage();
    hard.engage();
    expect(hard.state.current.nextRekeyAt).toBeLessThan(story.state.current.nextRekeyAt ?? 99);
    for (let i = 0; i < 60; i++) {
      story.step(DT, { R: 0.25, Phi: 0 });
      hard.step(DT, { R: 0.25, Phi: 0 });
    }
    expect(story.state.current.m).toBeLessThan(DISSONANCE_THRESHOLD);
    expect(hard.state.neural).toBeGreaterThan(story.state.neural);
    expect(hard.state.neural / story.state.neural).toBeCloseTo(1.3 / 0.4, 2);
  });

  it('widens Story/Easy gates and tightens Hard vs the M2 table', () => {
    const story = tuneGateWindow(GATE_WINDOWS.early, GATE_WINDOWS.late, 'easy');
    const hard = tuneGateWindow(GATE_WINDOWS.early, GATE_WINDOWS.late, 'hard');
    expect(story).toEqual({ early: 30, late: 22.5 });
    expect(hard).toEqual({ early: 15, late: 11.25 });
    const gates = tuneGates([SAMPLE_GATE], 'hard');
    expect(gates[0]!.early).toBe(15);
    expect(gates[0]!.late).toBe(11.25);

    const bus = createEventBus();
    const storyGates = createGates({ events: bus, gates: tuneGates([SAMPLE_GATE], 'story') });
    storyGates.update(80 - 30 - 0.5, DT);
    expect(storyGates.get('lobby-door')?.state).toBe('idle');
    storyGates.update(80 - 30 + 0.01, DT);
    expect(storyGates.get('lobby-door')?.state).toBe('open');
    const hardGates = createGates({ events: bus, gates: tuneGates([SAMPLE_GATE], 'hard') });
    hardGates.update(80 - 15 - 0.5, DT);
    expect(hardGates.get('lobby-door')?.state).toBe('idle');
    hardGates.update(80 - 15 + 0.01, DT);
    expect(hardGates.get('lobby-door')?.state).toBe('open');
  });

  it('applies through mission ICE factories and campaignTuneOpts', () => {
    const white = tuneIce(WHITE_ICE, { difficulty: 'hard' });
    expect(white.layers[0]!.tolRatio).toBeCloseTo(0.1 * 0.8, 10);
    const m2story = senseNetIce({ difficulty: 'story' });
    const m2hot = senseNetIce({ difficulty: 'story', heat: 2 });
    expect(m2story.layers[0]!.tolRatio).toBeCloseTo(ICE_LAYER_PRESETS['gray-2'].tolRatio * 1.6, 10);
    expect(m2hot.layers[0]!.rekeyEvery![0]).toBeLessThan(m2story.layers[0]!.rekeyEvery![0]);
    const m4s = turingIce(0, 'story');
    const m4h = turingIce(2, 'hard');
    expect(m4s.layers[0]!.feedbackDps).toBeCloseTo(3 * 0.4, 10);
    expect(m4h.layers[0]!.feedbackDps).toBeCloseTo(3 * 1.3, 10);
    expect(m4h.layers[0]!.rekeyEvery![0]).toBeLessThan(m4s.layers[0]!.rekeyEvery![0]);
    const ta = straylightIce({ difficulty: 'hard' });
    expect(ta.layers[0]!.tolRatio).toBeCloseTo(0.12 * 0.8, 10);
    expect(campaignTuneOpts({ difficulty: 'hard' }, { data: { campaign: { heat: 3 } } })).toEqual({
      difficulty: 'hard',
      heat: 3,
    });
  });
});
