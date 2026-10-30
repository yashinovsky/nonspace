import { describe, expect, it } from 'vitest';
import { LayerSim, type LayerEvent } from '../src/breach/LayerSim';
import { wrapAngle } from '../src/breach/PhaseLock';
import { DIFFICULTIES, type IceLayerDef, applyDifficulty, getDifficulty, getIce } from '../src/breach/presets';

const DT = 1 / 120;

/** An oracle player: always exactly on the target (accounting for its own roll). */
function perfect(sim: LayerSim): [number, number] {
  const s = sim.state;
  return [s.ratio[1] / s.ratio[0], s.phi - s.roll];
}

function run(sim: LayerSim, seconds: number, knobs: (s: LayerSim) => [number, number]): LayerEvent[] {
  const all: LayerEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && sim.state.status === 'engaged'; i++) {
    const [R, Phi] = knobs(sim);
    all.push(...sim.step(DT, R, Phi));
  }
  return all;
}

describe('LayerSim', () => {
  it('a perfect player cracks white ICE in exactly lockTime', () => {
    const def = getIce('white-1').layer;
    const sim = new LayerSim(def, 1);
    const ev = run(sim, 10, perfect);
    expect(sim.state.status).toBe('cracked');
    expect(sim.state.t).toBeCloseTo(def.lockTime, 1);
    expect(ev.filter((e) => e.type === 'lockStep').map((e) => (e as { step: number }).step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('drifts the target phase at phaseDrift rad/s', () => {
    const def = { ...getIce('gray-3').layer, rekeyEvery: undefined };
    const sim = new LayerSim(def, 2);
    const p0 = sim.state.phi;
    sim.step(0.5, 1, 0);
    expect(Math.abs(wrapAngle(sim.state.phi - p0))).toBeCloseTo(def.phaseDrift * 0.5, 9);
  });

  it('telegraphs every re-key ahead by the preset telegraph time, then resets the meter', () => {
    for (const d of DIFFICULTIES) {
      const def = applyDifficulty(getIce('gray-3').layer, d);
      const sim = new LayerSim(def, 3);
      const times: Array<[string, number]> = [];
      for (let i = 0; i < 40 * 120 && sim.state.status === 'engaged'; i++) {
        for (const e of sim.step(DT, 0.25, 3)) if (e.type === 'telegraph' || e.type === 'rekey') times.push([e.type, sim.state.t]);
      }
      expect(times.length).toBeGreaterThan(4);
      for (let i = 0; i + 1 < times.length; i += 2) {
        expect(times[i][0]).toBe('telegraph');
        expect(times[i + 1][0]).toBe('rekey');
        expect(times[i + 1][1] - times[i][1]).toBeCloseTo(def.telegraph, 1);
      }
      if (i32(d.id)) expect(def.telegraph).toBeGreaterThanOrEqual(0.8 * 0.8 - 1e-9);
    }
  });

  it('re-key while above 50% drops the meter to exactly 50%', () => {
    const def: IceLayerDef = { ...getIce('gray-2').layer, rekeyEvery: [2.2, 2.2], telegraph: 0.5, lockTime: 4 };
    const sim = new LayerSim(def, 4);
    const ev = run(sim, 2.25, perfect);
    const rk = ev.find((e) => e.type === 'rekey') as Extract<LayerEvent, { type: 'rekey' }>;
    expect(rk.meterBefore).toBeGreaterThan(0.5);
    expect(rk.meterAfter).toBe(0.5);
    expect(sim.state.stats.setbacks).toBe(1);
  });

  it('accrues trace at traceRate whatever m is, and neural only while m < 0.3', () => {
    const def = { ...getIce('gray-3').layer, rekeyEvery: undefined };
    const a = new LayerSim(def, 5);
    run(a, 1, () => [0.25, 0]);
    expect(a.state.trace).toBeCloseTo(def.traceRate, 6);
    expect(a.state.neural).toBeCloseTo(def.feedbackDps, 6);
    const b = new LayerSim({ ...def, lockTime: 100 }, 5);
    run(b, 1, perfect);
    expect(b.state.trace).toBeCloseTo(def.traceRate, 6);
    expect(b.state.neural).toBe(0);
  });

  it('burns at 100% trace', () => {
    const sim = new LayerSim({ ...getIce('white-1').layer, traceRate: 50 }, 6);
    const ev = run(sim, 5, () => [0.25, 0]);
    expect(sim.state.status).toBe('burned');
    expect(ev.some((e) => e.type === 'burned')).toBe(true);
  });

  it('black ICE grips past 60 neural and flatlines when the 8 s countdown runs out', () => {
    const def = { ...getIce('black-1').layer, rekeyEvery: undefined };
    const sim = new LayerSim(def, 7);
    const ev = run(sim, 30, () => [0.25, 0]);
    const grip = ev.find((e) => e.type === 'grip') as Extract<LayerEvent, { type: 'grip' }>;
    expect(grip.reason).toBe('neural');
    expect(sim.state.status).toBe('flatline');
    expect(sim.state.t).toBeCloseTo(Math.min(60 / def.feedbackDps + 8, 100 / def.feedbackDps), 1);
  });

  it('black ICE grips on a re-key failed below 30% lock; a full lock during the grip cracks it', () => {
    const def = getIce('black-1').layer;
    const sim = new LayerSim(def, 8);
    run(sim, 20, (s) => (s.state.grip ? perfect(s) : [0.25, 0]));
    expect(sim.state.status).toBe('cracked');
    expect(sim.state.grip).toBeNull();
  });

  it('the proposed tuning grace period stops the first re-key from gripping', () => {
    const def = applyDifficulty(getIce('black-1', 'proposed').layer, getDifficulty('normal', 'proposed'));
    const sim = new LayerSim({ ...def, feedbackDps: 0 }, 9);
    const ev = run(sim, def.grip!.rekeyGraceS! - 0.01, () => [0.25, 0]);
    expect(ev.some((e) => e.type === 'rekey')).toBe(true);
    expect(ev.some((e) => e.type === 'grip')).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const def = getIce('black-1').layer;
    const trace = (seed: number) => {
      const sim = new LayerSim(def, seed);
      return run(sim, 12, () => [1.3, 0.5]).map((e) => `${e.type}`).join(',') + sim.state.phi.toFixed(9);
    };
    expect(trace(11)).toBe(trace(11));
    expect(trace(11)).not.toBe(trace(12));
  });
});

function i32(id: string): boolean {
  return id === 'hard';
}
