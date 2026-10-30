import { describe, expect, it } from 'vitest';
import {
  canEngageFrom,
  createBreachController,
  ENGAGE_RANGE,
  JACK_OUT_HOLD,
  KNOB_FINE,
  KNOB_MOUSE_LN,
  KNOB_MOUSE_PHI,
  stepKnobs,
} from '../../src/breach/BreachController';
import { createGrip, GRIP_SECONDS } from '../../src/breach/Grip';
import { createHeat, HEAT_MAX } from '../../src/deck/Heat';
import {
  createNeuralLoad,
  NEURAL_REGEN_DELAY,
  NEURAL_REGEN_PER_S,
  neuralMaxForScars,
  SCAR_MAX_PENALTY,
} from '../../src/deck/NeuralLoad';
import { createTrace, HULL_TRACE_RATE, TRACE_HEAT_THRESHOLD } from '../../src/deck/Trace';
import { sampleFlatlineVisual, FLATLINE_TIMING } from '../../src/app/modes/Flatline';
import { WHITE_ICE } from '../../src/content/ice/white';
import { GRAY_ICE } from '../../src/content/ice/gray';
import { BLACK_ICE } from '../../src/content/ice/black';
import { createEventBus } from '../../src/core/events';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { SIM_DT } from '../../src/core/loop';
import type { InputFrame } from '../../src/input/Input';
import { knobToR } from '../../src/breach/PhaseLock';

const DT = SIM_DT;
const ICE = { x: 0, y: 0, z: 0 };
const FWD = { x: 0, y: 0, z: -1 };

function stubFrame(
  over: Partial<Omit<InputFrame, 'down' | 'pressed' | 'released' | 'held'>> & {
    fine?: boolean;
    jackHeld?: number;
    engagePress?: boolean;
    jackPress?: boolean;
  } = {},
): InputFrame {
  const fine = over.fine ?? false;
  const jackHeld = over.jackHeld ?? 0;
  const engagePress = over.engagePress ?? false;
  const jackPress = over.jackPress ?? false;
  return {
    tick: 1,
    dt: DT,
    lookX: 0,
    lookY: 0,
    mouseDx: 0,
    mouseDy: 0,
    thrust: 0,
    strafe: 0,
    vertical: 0,
    knobX: 0,
    knobY: 0,
    down: (a) => (a === 'fineAdjust' && fine) || (a === 'jackOut' && jackHeld > 0),
    pressed: (a) => (a === 'engage' && engagePress) || (a === 'jackOut' && jackPress),
    released: () => false,
    held: (a) => (a === 'jackOut' ? jackHeld : 0),
    pointerLocked: true,
    gamepadConnected: false,
    capturingText: false,
    textValue: '',
    textInserted: '',
    textBackspace: 0,
    textEnter: false,
    textEscape: false,
    ...over,
  };
}

function run(
  ctrl: ReturnType<typeof createBreachController>,
  seconds: number,
  frame = stubFrame(),
) {
  const n = Math.round(seconds / DT);
  const outs = [];
  for (let i = 0; i < n; i++) outs.push(ctrl.step(DT, frame));
  return outs;
}

describe('engage from a facet', () => {
  it('allows engage at 60 u facing the ice and rejects 61 u or looking away', () => {
    const facing = { x: 0, y: 0, z: ENGAGE_RANGE };
    expect(canEngageFrom(facing, FWD, ICE)).toBe(true);
    expect(canEngageFrom({ x: 0, y: 0, z: ENGAGE_RANGE + 1 }, FWD, ICE)).toBe(false);
    expect(canEngageFrom(facing, { x: 0, y: 0, z: 1 }, ICE)).toBe(false);

    const ctrl = createBreachController();
    const ice = { def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 };
    expect(ctrl.tryEngage(facing, FWD, ice)).toBe(true);
    expect(ctrl.engaged).toBe(true);
    ctrl.disengage();
    expect(ctrl.tryEngage({ x: 0, y: 0, z: ENGAGE_RANGE + 1 }, FWD, ice)).toBe(false);
    expect(ctrl.engaged).toBe(false);
  });
});

describe('knobs §3.9', () => {
  it('maps mouse X to ratio (log) and mouse Y to phase; Shift is fine adjust', () => {
    const coarse = stepKnobs(0, 0, { mouseDx: 10, mouseDy: 5, knobX: 0, knobY: 0 }, DT, false);
    const fine = stepKnobs(0, 0, { mouseDx: 10, mouseDy: 5, knobX: 0, knobY: 0 }, DT, true);
    expect(coarse.lnR).toBeCloseTo(10 * KNOB_MOUSE_LN, 8);
    expect(coarse.Phi).toBeCloseTo(5 * KNOB_MOUSE_PHI, 8);
    expect(fine.lnR).toBeCloseTo(coarse.lnR * KNOB_FINE, 8);
    expect(fine.Phi).toBeCloseTo(coarse.Phi * KNOB_FINE, 8);

    const ctrl = createBreachController();
    ctrl.engage({ def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 });
    const r0 = ctrl.knobs.R;
    ctrl.step(DT, stubFrame({ mouseDx: 40 }));
    expect(ctrl.knobs.R).not.toBeCloseTo(r0, 5);
    expect(ctrl.knobs.R).toBeCloseTo(knobToR(ctrl.knobs.lnR), 8);
    const phi0 = ctrl.knobs.Phi;
    ctrl.step(DT, stubFrame({ mouseDy: 20 }));
    expect(ctrl.knobs.Phi).not.toBeCloseTo(phi0, 5);
  });
});

describe('neural and trace rates (simulated clock)', () => {
  it('regenerates neural at 4/s after a 3 s delay when not engaged', () => {
    const n = createNeuralLoad({ value: 40 });
    n.step(NEURAL_REGEN_DELAY - 0.05, false);
    expect(n.value).toBeCloseTo(40, 5);
    n.step(0.05, false);
    n.step(2, false);
    expect(n.value).toBeCloseTo(40 - 2 * NEURAL_REGEN_PER_S, 4);
    n.step(1, true);
    expect(n.value).toBeCloseTo(40 - 2 * NEURAL_REGEN_PER_S, 4);
  });

  it('scars reduce max neural by 5', () => {
    expect(neuralMaxForScars(3)).toBe(100 - 3 * SCAR_MAX_PENALTY);
    const n = createNeuralLoad({ value: 100, scars: 2 });
    expect(n.max).toBe(90);
    expect(n.value).toBe(90);
  });

  it('trace rises at the ICE traceRate while engaged and burns at 100', () => {
    const events = createEventBus();
    const rec: string[] = [];
    events.on('jackOut', (e) => rec.push(e.reason));
    const ctrl = createBreachController({ events });
    ctrl.engage({ def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 });
    const rate = WHITE_ICE.layers[0]!.traceRate;
    run(ctrl, 2, stubFrame({ mouseDx: 400 }));
    expect(ctrl.trace.value).toBeCloseTo(2 * rate, 0);
    const burned = ctrl.forceBurned();
    expect(burned.kind).toBe('burned');
    events.flush();
    expect(rec).toEqual(['burned']);
    expect(ctrl.engaged).toBe(false);
  });

  it('gray ICE dissonance raises neural at feedbackDps', () => {
    const ctrl = createBreachController();
    ctrl.engage({ def: GRAY_ICE, x: 0, y: 0, z: 0, seed: 2 });
    const dps = GRAY_ICE.layers[0]!.feedbackDps;
    run(ctrl, 1, stubFrame({ mouseDx: 800 }));
    expect(ctrl.neural.value).toBeGreaterThan(0);
    expect(ctrl.neural.value).toBeCloseTo(dps, 0);
  });

  it('hull contact while idle adds trace at HULL_TRACE_RATE', () => {
    const t = createTrace();
    t.step(2, HULL_TRACE_RATE);
    expect(t.value).toBeCloseTo(4, 8);
  });
});

describe('grip', () => {
  it('blocks jack-out and times out at 8 s', () => {
    const g = createGrip();
    expect(g.jackOutBlocked).toBe(false);
    g.start('black-turing');
    expect(g.jackOutBlocked).toBe(true);
    expect(g.step(GRIP_SECONDS - 0.05)).toBe('holding');
    expect(g.remaining).toBeCloseTo(0.05, 8);
    expect(g.step(0.05)).toBe('timeout');
    expect(g.active).toBe(false);
    expect(g.jackOutBlocked).toBe(false);
  });

  it('controller grip disables jack-out and flatlines on the 8 s countdown', () => {
    const events = createEventBus();
    const flats: boolean[] = [];
    events.on('flatline', (e) => flats.push(e.scripted));
    const ctrl = createBreachController({ events });
    ctrl.engage({ def: BLACK_ICE, x: 0, y: 0, z: 0, seed: 3 });
    ctrl.forceGrip('neural');
    expect(ctrl.canJackOut()).toBe(false);
    expect(ctrl.jackOutReady(JACK_OUT_HOLD)).toBe(false);
    const outs = run(ctrl, GRIP_SECONDS + 0.05);
    expect(outs.some((o) => o.kind === 'flatline')).toBe(true);
    events.flush();
    expect(flats).toEqual([false]);
    expect(ctrl.neural.scars).toBe(1);
  });
});

describe('flatline sequence and scars', () => {
  it('plays beeps → collapse/tone → 2 s linger → silence green line', () => {
    expect(sampleFlatlineVisual(0.1).phase).toBe('beeps');
    expect(sampleFlatlineVisual(0.1).eegFlat).toBe(true);
    const tone = sampleFlatlineVisual(FLATLINE_TIMING.toneStart + 0.1);
    expect(tone.phase).toBe('tone');
    expect(tone.collapse.scaleY).toBeLessThan(1);
    const linger = sampleFlatlineVisual(
      FLATLINE_TIMING.toneStart + FLATLINE_TIMING.collapseDur + 0.2,
    );
    expect(linger.phase).toBe('linger');
    expect(linger.collapse.scaleX).toBeLessThan(0.05);
    const silence = sampleFlatlineVisual(FLATLINE_TIMING.silenceAt + 0.05);
    expect(silence.phase).toBe('silence');
    expect(silence.greenLine).toBeGreaterThan(0.2);
    expect(silence.black).toBe(1);
    const done = sampleFlatlineVisual(FLATLINE_TIMING.total);
    expect(done.done).toBe(true);
  });

  it('returns to checkpoint with a scar; scripted skips the scar', () => {
    const save = createSaveStore({ storage: createMemoryStorage() });
    const ctrl = createBreachController({ save });
    ctrl.neural.set(20);
    ctrl.trace.set(10);
    ctrl.markCheckpoint();
    ctrl.engage({ def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 });
    ctrl.neural.set(80);
    ctrl.forceFlatline(false);
    expect(ctrl.neural.scars).toBe(1);
    expect(save.data.campaign.scars).toBe(1);
    expect(save.data.campaign.flatlines).toBe(1);
    ctrl.restoreCheckpoint();
    expect(ctrl.neural.value).toBeCloseTo(20, 5);
    expect(ctrl.trace.value).toBeCloseTo(10, 5);
    expect(ctrl.engaged).toBe(false);

    ctrl.forceFlatline(true);
    expect(ctrl.neural.scars).toBe(1);
  });
});

describe('heat', () => {
  it('ticks on burned or trace > 50, clamps at 3', () => {
    const h = createHeat();
    h.applyRunEnd(40, false);
    expect(h.value).toBe(0);
    h.applyRunEnd(TRACE_HEAT_THRESHOLD + 1, false);
    expect(h.value).toBe(1);
    h.applyRunEnd(0, true);
    expect(h.value).toBe(2);
    h.applyRunEnd(99, true);
    expect(h.value).toBe(3);
    h.applyRunEnd(99, true);
    expect(h.value).toBe(HEAT_MAX);
    h.lieLow();
    expect(h.value).toBe(2);
  });
});
