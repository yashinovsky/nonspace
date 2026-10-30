import { describe, expect, it } from 'vitest';
import {
  PHASE_LOCK_F0,
  beatingHz,
  phaseConsonance,
  phaseLockBed,
  ratioConsonance,
  syncPhaseLockEngine,
  telegraphBlend,
  telegraphProgress,
  type PhaseLockSession,
} from '../../src/audio/phaseLock';
import { createRecordingAudioEngine } from '../../src/testing/mocks';
import { createBreachController } from '../../src/breach/BreachController';
import { WHITE_ICE } from '../../src/content/ice/white';
import { BLACK_ICE } from '../../src/content/ice/black';
import { SIM_DT } from '../../src/core/loop';
import type { InputFrame } from '../../src/input/Input';

function stubFrame(): InputFrame {
  return {
    tick: 1,
    dt: SIM_DT,
    lookX: 0,
    lookY: 0,
    mouseDx: 0,
    mouseDy: 0,
    thrust: 0,
    strafe: 0,
    vertical: 0,
    knobX: 0,
    knobY: 0,
    down: () => false,
    pressed: () => false,
    released: () => false,
    held: () => 0,
    pointerLocked: true,
    gamepadConnected: false,
    capturingText: false,
    textValue: '',
    textInserted: '',
    textBackspace: 0,
    textEnter: false,
    textEscape: false,
  };
}

describe('phase lock bed math', () => {
  it('beats on a ratio mismatch and goes quiet on a 3:2 lock', () => {
    expect(beatingHz(2, 3, 1.5, 110)).toBeCloseTo(0, 8);
    expect(beatingHz(2, 3, 1.12, 110)).toBeGreaterThan(20);
    expect(phaseConsonance(0, 0)).toBeCloseTo(1, 8);
    expect(phaseConsonance(Math.PI, 0)).toBeCloseTo(0, 8);
    expect(ratioConsonance(1.5, 2, 3)).toBeGreaterThan(0.99);
    expect(ratioConsonance(1.12, 2, 3)).toBeLessThan(0.3);
  });

  it('keeps ICE partials as just intervals of a mission-key f0', () => {
    const lock = phaseLockBed(2, 3, 110, 45, 'minor', 1.5, 0, 0);
    expect(lock.f0).toBeCloseTo(110, 6);
    expect(lock.iceL).toBeCloseTo(220, 5);
    expect(lock.iceR).toBeCloseTo(330, 5);
    expect(lock.brkR).toBeCloseTo(330, 5);
    expect(lock.beatingHz).toBeCloseTo(0, 5);
    expect(lock.m).toBeGreaterThan(0.95);

    const off = phaseLockBed(2, 3, 100, 45, 'dorian', 1.12, 0.9, 0);
    expect(off.f0).toBeGreaterThan(90);
    expect(off.beatingHz).toBeGreaterThan(1);
    expect(off.m).toBeLessThan(0.5);
  });

  it('interpolates telegraph partials from 0 to 1', () => {
    expect(telegraphProgress(1, 1, 2)).toBe(0);
    expect(telegraphProgress(1.5, 1, 2)).toBeCloseTo(0.5, 8);
    expect(telegraphProgress(3, 1, 2)).toBe(1);
    const mid = telegraphBlend(2, 3, { nextA: 4, nextB: 5, k: 0.5 });
    expect(mid.a).toBeCloseTo(3, 8);
    expect(mid.b).toBeCloseTo(4, 8);
  });
});

describe('syncPhaseLockEngine', () => {
  it('starts, slides the target, then stops without needing a device', () => {
    const { engine, callsTo } = createRecordingAudioEngine();
    const session: PhaseLockSession = { started: false, music: null };
    syncPhaseLockEngine(
      engine,
      session,
      {
        engaged: true,
        a: 2,
        b: 3,
        phi: 0,
        R: 1.5,
        Phi: 0,
        telegraph: null,
        grip: false,
        meter: 0.2,
      },
      PHASE_LOCK_F0,
    );
    expect(session.started).toBe(true);
    expect(callsTo('phaseLock.start')[0]?.args).toEqual([2, 3, 110]);
    expect(callsTo('music.setState')[0]?.args).toEqual(['breach']);

    syncPhaseLockEngine(
      engine,
      session,
      {
        engaged: true,
        a: 2,
        b: 3,
        phi: 0.1,
        R: 1.5,
        Phi: 0.1,
        telegraph: { nextA: 3, nextB: 4, k: 0.5 },
        grip: false,
        meter: 0.4,
      },
      PHASE_LOCK_F0,
    );
    const target = callsTo('phaseLock.setTarget').at(-1)?.args as number[];
    expect(target[0]).toBeCloseTo(2.5, 8);
    expect(target[1]).toBeCloseTo(3.5, 8);

    syncPhaseLockEngine(
      engine,
      session,
      {
        engaged: true,
        a: 3,
        b: 4,
        phi: 0,
        R: 1.2,
        Phi: 0,
        telegraph: null,
        grip: true,
        meter: 0.2,
      },
      PHASE_LOCK_F0,
    );
    expect(callsTo('music.setState').at(-1)?.args).toEqual(['grip']);

    syncPhaseLockEngine(engine, session, null, PHASE_LOCK_F0);
    expect(session.started).toBe(false);
    expect(callsTo('phaseLock.stop')).toHaveLength(1);
  });
});

describe('BreachController audio drive', () => {
  it('calls start/setPlayer on engage and stop on disengage', () => {
    const { engine, callsTo } = createRecordingAudioEngine();
    const ctrl = createBreachController({ audio: engine });
    ctrl.engage({ def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 });
    expect(callsTo('phaseLock.start')).toHaveLength(1);
    expect(callsTo('phaseLock.setPlayer').length).toBeGreaterThan(0);
    expect(callsTo('music.setState')[0]?.args).toEqual(['breach']);
    ctrl.step(SIM_DT, stubFrame());
    expect(callsTo('phaseLock.setTarget').length).toBeGreaterThan(0);
    ctrl.disengage();
    expect(callsTo('phaseLock.stop')).toHaveLength(1);
  });

  it('still solves visually with no audio attached', () => {
    const ctrl = createBreachController();
    ctrl.engage({ def: WHITE_ICE, x: 0, y: 0, z: 0, seed: 1 });
    expect(ctrl.engaged).toBe(true);
    expect(ctrl.ice?.state.current.m).toBeGreaterThanOrEqual(0);
    ctrl.disengage();
    expect(ctrl.engaged).toBe(false);
  });

  it('switches music to grip when black ICE grips', () => {
    const { engine, callsTo } = createRecordingAudioEngine();
    const ctrl = createBreachController({ audio: engine });
    ctrl.engage({ def: BLACK_ICE, x: 0, y: 0, z: 0, seed: 3 });
    ctrl.neural.set(61);
    if (ctrl.ice) ctrl.ice.state.neural = 61;
    ctrl.forceGrip('neural');
    expect(ctrl.grip.active).toBe(true);
    expect(callsTo('music.setState').at(-1)?.args).toEqual(['grip']);
  });
});
