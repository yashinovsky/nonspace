import { describe, expect, it } from 'vitest';
import { createIceModel, type IceModel, type IceSimEvent } from '../../src/breach/IceModel';
import { DISSONANCE_THRESHOLD, wrapAngle } from '../../src/breach/PhaseLock';
import { BLACK_ICE } from '../../src/content/ice/black';
import { GRAY_ICE } from '../../src/content/ice/gray';
import { WHITE_ICE } from '../../src/content/ice/white';
import { createEventBus } from '../../src/core/events';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { sampleIceDef } from '../../src/testing/fixtures';
import { Beam } from '../../src/render/lines/BeamBatch';

const DT = 1 / 120;

function perfect(model: IceModel): { R: number; Phi: number } {
  const s = model.state.current;
  return { R: s.ratio[1] / s.ratio[0], Phi: s.phi - s.roll };
}

function run(model: IceModel, seconds: number, knobs = perfect): IceSimEvent[] {
  const all: IceSimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && model.state.status === 'engaged'; i++) {
    all.push(...model.step(DT, knobs(model)));
  }
  return all;
}

describe('IceModel', () => {
  it('a perfect player cracks white ICE in lockTime', () => {
    const model = createIceModel(WHITE_ICE, { seed: 1 });
    model.engage();
    const ev = run(model, 10);
    expect(model.state.status).toBe('cracked');
    expect(model.state.t).toBeCloseTo(WHITE_ICE.layers[0]!.lockTime, 1);
    expect(ev.some((e) => e.type === 'iceLayerCracked' && e.layer === 0)).toBe(true);
  });

  it('drifts the target phase at phaseDrift rad/s', () => {
    const def = sampleIceDef({
      layers: [{ ...ICE_LAYER_PRESETS['gray-3'], rekeyEvery: undefined }],
    });
    const model = createIceModel(def, { seed: 2 });
    model.engage();
    const p0 = model.state.current.phi;
    model.step(0.5, { R: 1, Phi: 0 });
    expect(Math.abs(wrapAngle(model.state.current.phi - p0))).toBeCloseTo(
      def.layers[0]!.phaseDrift * 0.5,
      9,
    );
  });

  it('white ICE never schedules a re-key', () => {
    const model = createIceModel(WHITE_ICE, { seed: 1 });
    model.engage();
    expect(model.state.current.nextRekeyAt).toBeNull();
    const ev = run(model, 1, () => ({ R: 0.25, Phi: 0 }));
    expect(ev.some((e) => e.type === 'iceRekeyTelegraph' || e.type === 'iceRekey')).toBe(false);
  });

  it('telegraphs then re-keys, resetting the lock meter', () => {
    const def = sampleIceDef({
      id: 'gray-test',
      class: 'gray',
      layers: [
        {
          ...ICE_LAYER_PRESETS['gray-2'],
          rekeyEvery: [1.2, 1.2],
          telegraph: 0.4,
          lockTime: 8,
        },
      ],
    });
    const model = createIceModel(def, { seed: 4 });
    model.engage();
    const ev = run(model, 1.4, perfect);
    const tel = ev.find((e) => e.type === 'iceRekeyTelegraph');
    const rk = ev.find((e) => e.type === 'iceRekey');
    expect(tel).toBeTruthy();
    expect(rk).toBeTruthy();
    expect(model.state.current.telegraph).toBeNull();
  });

  it('re-key while above 50% drops the meter to 50%', () => {
    const def = sampleIceDef({
      class: 'gray',
      layers: [
        {
          ...ICE_LAYER_PRESETS['gray-2'],
          rekeyEvery: [2.2, 2.2],
          telegraph: 0.5,
          lockTime: 4,
        },
      ],
    });
    const model = createIceModel(def, { seed: 4 });
    model.engage();
    let meterAfter = -1;
    for (let i = 0; i < 400 && model.state.status === 'engaged'; i++) {
      const ev = model.step(DT, perfect(model));
      if (ev.some((e) => e.type === 'iceRekey')) {
        meterAfter = model.state.current.meter;
        break;
      }
    }
    expect(meterAfter).toBeGreaterThan(0.48);
    expect(meterAfter).toBeLessThanOrEqual(0.5);
  });

  it('accrues neural only while m < 0.3', () => {
    const def = sampleIceDef({
      layers: [{ ...ICE_LAYER_PRESETS['gray-3'], rekeyEvery: undefined }],
    });
    const a = createIceModel(def, { seed: 5 });
    a.engage();
    run(a, 1, () => ({ R: 0.25, Phi: 0 }));
    expect(a.state.neural).toBeCloseTo(def.layers[0]!.feedbackDps, 5);
    expect(a.state.current.m).toBeLessThan(DISSONANCE_THRESHOLD);
    const b = createIceModel(
      { ...def, layers: [{ ...def.layers[0]!, lockTime: 100 }] },
      { seed: 5 },
    );
    b.engage();
    run(b, 1, perfect);
    expect(b.state.neural).toBe(0);
  });

  it('grips black ICE when neural passes the threshold', () => {
    const model = createIceModel(BLACK_ICE, { seed: 7, neural: 59 });
    model.engage();
    const ev = run(model, 0.5, () => ({ R: 0.25, Phi: 0 }));
    expect(ev.some((e) => e.type === 'gripStart')).toBe(true);
    expect(model.state.grip?.reason).toBe('neural');
    expect(model.state.grip?.deadline).toBeCloseTo(model.state.grip!.start + 8, 6);
  });

  it('grips black ICE on a failed re-key below 30% lock', () => {
    const def = sampleIceDef({
      class: 'black',
      hue: Beam.MIL,
      layers: [
        {
          ...ICE_LAYER_PRESETS['black-1'],
          rekeyEvery: [0.6, 0.6],
          telegraph: 0.2,
          lockTime: 20,
        },
      ],
    });
    const model = createIceModel(def, { seed: 8 });
    model.engage();
    const ev = run(model, 0.9, () => ({ R: 0.25, Phi: 0 }));
    expect(ev.some((e) => e.type === 'iceRekey')).toBe(true);
    expect(ev.some((e) => e.type === 'gripStart')).toBe(true);
    expect(model.state.grip?.reason).toBe('rekey');
  });

  it('cracking a layer ends grip and advances on multi-layer ICE', () => {
    const model = createIceModel(GRAY_ICE, { seed: 9 });
    model.engage();
    expect(GRAY_ICE.layers.length).toBeGreaterThan(1);
    const first = run(model, 4, perfect);
    expect(first.some((e) => e.type === 'iceLayerCracked' && e.layer === 0)).toBe(true);
    expect(model.state.status).toBe('engaged');
    expect(model.state.current.index).toBe(1);
    run(model, 8, perfect);
    expect(model.state.status).toBe('cracked');
  });

  it('freeze stops drift and re-keys', () => {
    const def = sampleIceDef({
      layers: [{ ...ICE_LAYER_PRESETS['gray-3'], rekeyEvery: [0.4, 0.4], telegraph: 0.1 }],
    });
    const model = createIceModel(def, { seed: 3 });
    model.engage();
    model.setFrozen(true);
    const phi = model.state.current.phi;
    const ev = run(model, 1, () => ({ R: 0.25, Phi: 0 }));
    expect(model.state.current.phi).toBeCloseTo(phi, 9);
    expect(ev.some((e) => e.type === 'iceRekey' || e.type === 'iceRekeyTelegraph')).toBe(false);
  });

  it('posts GameEvents on the bus', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.on('iceEngaged', (e) => seen.push(e.type));
    bus.on('iceLayerCracked', (e) => seen.push(e.type));
    const model = createIceModel(WHITE_ICE, { seed: 1, events: bus });
    model.engage();
    bus.flush();
    run(model, 3, perfect);
    bus.flush();
    expect(seen).toContain('iceEngaged');
    expect(seen).toContain('iceLayerCracked');
  });

  it('forceTelegraph and forceGrip work for the lab', () => {
    const model = createIceModel(BLACK_ICE, { seed: 1 });
    model.engage();
    const tel = model.forceTelegraph();
    expect(tel[0]?.type).toBe('iceRekeyTelegraph');
    expect(model.state.current.telegraph).not.toBeNull();
    const g = model.forceGrip();
    expect(g[0]?.type).toBe('gripStart');
    expect(model.state.grip).not.toBeNull();
  });
});
