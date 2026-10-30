import { describe, expect, it } from 'vitest';
import { createIceModel, type IceModel } from '../../src/breach/IceModel';
import { wrapAngle } from '../../src/breach/PhaseLock';
import { GRAY_ICE } from '../../src/content/ice/gray';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { getSoft, ratioLabel, SOFTS } from '../../src/content/softs';
import { createEventBus } from '../../src/core/events';
import { createWatcherLureStub, stepMimicKnobs } from '../../src/deck/softs/effects';
import {
  createSoftsRuntime,
  DIXIE_READ_ID,
  type DixieReadApi,
} from '../../src/deck/softs/registry';
import { sampleIceDef } from '../../src/testing/fixtures';

function engageGray(seed = 2) {
  const ice = createIceModel(GRAY_ICE, { seed });
  ice.engage();
  return ice;
}

describe('M4.4 softs content', () => {
  it('matches the §9.4 effect table', () => {
    expect(getSoft('probe')?.effect).toEqual({ kind: 'revealRatio', seconds: 3 });
    expect(getSoft('clamp')?.effect).toEqual({
      kind: 'freezeDrift',
      seconds: 5,
      delayRekey: 5,
    });
    expect(getSoft('damper')?.effect).toEqual({
      kind: 'damper',
      seconds: 10,
      feedbackMul: 0.3,
    });
    expect(getSoft('decoy')?.effect).toEqual({ kind: 'decoy', seconds: 8, traceMul: 0.5 });
    expect(getSoft('mimic')?.effect).toEqual({ kind: 'mimic', rate: 0.15 });
    expect(getSoft('kuang')?.effect).toEqual({ kind: 'kuang' });
    expect(SOFTS).toHaveLength(6);
    expect(ratioLabel(3, 2)).toBe('3:2');
    expect(SOFTS.some((s) => s.id === DIXIE_READ_ID)).toBe(false);
  });
});

describe('M4.4 registry charges and cooldowns', () => {
  it('persists charges and cooldowns across a snapshot for the run', () => {
    const ice = engageGray();
    const events = createEventBus();
    const used: string[] = [];
    events.on('softUsed', (e) => used.push(e.softId));
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    expect(runtime.chargesLeft('probe')).toBe(3);
    expect(runtime.use('probe', { ice, events }).ok).toBe(true);
    expect(runtime.chargesLeft('probe')).toBe(2);
    expect(runtime.use('clamp', { ice, events }).ok).toBe(true);
    events.flush();
    expect(runtime.cooldownLeft('clamp')).toBeCloseTo(15, 5);
    const snap = runtime.snapshot();
    const other = createSoftsRuntime();
    other.restore(snap);
    expect(other.chargesLeft('probe')).toBe(2);
    expect(other.cooldownLeft('clamp')).toBeCloseTo(15, 5);
    expect(other.revealLabel).toBe(runtime.revealLabel);
    expect(used).toEqual(['probe', 'clamp']);
    expect(runtime.use('clamp', { ice, events }).fail).toBe('cooldown');
  });

  it('locks MIMIC until Act II unless assist mimicAlways', () => {
    const ice = engageGray();
    const locked = createSoftsRuntime({ act: 1 });
    expect(locked.use('mimic', { ice }).fail).toBe('locked');
    const assist = createSoftsRuntime({ mimicAlways: true });
    expect(assist.use('mimic', { ice }).ok).toBe(true);
    expect(assist.use('mimic', { ice }).fail).toBe('mimic-spent');
  });
});

describe('M4.4 effects', () => {
  it('PROBE reveals the current ratio for 3 s', () => {
    const ice = engageGray();
    const [a, b] = ice.state.current.ratio;
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    runtime.use('probe', { ice });
    expect(runtime.revealLabel).toBe(ratioLabel(a, b));
    runtime.step(2.9, { ice });
    expect(runtime.revealLabel).toBe(ratioLabel(a, b));
    runtime.step(0.2, { ice });
    expect(runtime.revealLabel).toBeNull();
  });

  it('CLAMP freezes phase drift and delays the next re-key by 5 s', () => {
    const def = sampleIceDef({
      class: 'gray',
      layers: [{ ...ICE_LAYER_PRESETS['gray-2'], rekeyEvery: [6, 6] }],
    });
    const ice = createIceModel(def, { seed: 4 });
    ice.engage();
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    const rekey0 = ice.state.current.nextRekeyAt;
    expect(rekey0).not.toBeNull();
    const phi0 = ice.state.current.phi;
    runtime.use('clamp', { ice });
    expect(ice.state.current.nextRekeyAt).toBeCloseTo((rekey0 ?? 0) + 5, 8);
    expect(runtime.iceMods.freezeDrift).toBe(true);
    ice.step(0.5, { R: 1, Phi: 0, freezeDrift: true });
    expect(wrapAngle(ice.state.current.phi - phi0)).toBeCloseTo(0, 8);
  });

  it('DAMPER multiplies dissonance feedback by 0.3', () => {
    const ice = engageGray();
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    const n0 = ice.state.neural;
    ice.step(1, { R: 0.25, Phi: 0 });
    const undamped = ice.state.neural - n0;

    const ice2 = engageGray();
    runtime.use('damper', { ice: ice2 });
    expect(runtime.iceMods.feedbackMul).toBe(0.3);
    ice2.step(1, { R: 0.25, Phi: 0, feedbackMul: 0.3 });
    const damped = ice2.state.neural;
    expect(damped).toBeCloseTo(undamped * 0.3, 5);
  });

  it('DECOY lures the watcher stub and halves trace gain', () => {
    const ice = engageGray();
    const lure = createWatcherLureStub();
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    const t0 = ice.state.trace;
    ice.step(1, { R: 1, Phi: 0 });
    const raw = ice.state.trace - t0;

    const ice2 = engageGray();
    expect(runtime.use('decoy', { ice: ice2, lure, player: { x: 1, y: 2, z: 3 } }).ok).toBe(true);
    expect(lure.lured).toBe(true);
    expect(lure.lure?.x).toBe(1);
    expect(runtime.iceMods.traceMul).toBe(0.5);
    ice2.step(1, { R: 1, Phi: 0, traceMul: 0.5 });
    expect(ice2.state.trace).toBeCloseTo(raw * 0.5, 5);
    runtime.step(8.1, { ice: ice2, lure });
    expect(lure.lured).toBe(false);
    expect(runtime.decoy).toBeNull();
  });

  it('MIMIC converges ln R and Φ at 0.15/s', () => {
    const knobs = { lnR: 0, Phi: 0 };
    stepMimicKnobs(knobs, Math.log(1.5), 0.6, 0.15, 1);
    expect(knobs.lnR).toBeCloseTo(0.15, 8);
    expect(knobs.Phi).toBeCloseTo(0.15, 8);
    const ice = engageGray();
    const runtime = createSoftsRuntime({ mimicAlways: true });
    runtime.use('mimic', { ice });
    const target = Math.log(ice.state.current.ratio[1]! / ice.state.current.ratio[0]!);
    const k = { lnR: 0, Phi: ice.state.current.phi + 1 };
    runtime.applyMimic(k, ice, 1);
    expect(Math.abs(k.lnR)).toBeCloseTo(0.15, 5);
    expect(Math.sign(k.lnR)).toBe(Math.sign(target) || 1);
  });

  it('KUANG cracks the current layer', () => {
    const ice = engageGray();
    const runtime = createSoftsRuntime();
    runtime.unlockAll();
    expect(runtime.use('kuang', { ice }).ok).toBe(true);
    expect(ice.state.status === 'cracked' || ice.state.current.index > 0).toBe(true);
    expect(runtime.use('kuang', { ice }).fail).toBe('empty');
  });

  it('Dixie H is a no-op without a companion and forwards to DixieReadApi', () => {
    const ice = engageGray();
    const runtime = createSoftsRuntime();
    const events = createEventBus();
    const lines: string[] = [];
    events.on('dixieSay', (e) => lines.push(e.lineId));
    expect(runtime.askDixie({ ice, events }).ok).toBe(false);
    expect(runtime.askDixie({ ice, events }).fail).toBe('no-companion');
    runtime.step(4.2, { ice, events });
    events.flush();
    expect(lines).toEqual([]);

    const seen: Array<IceModel | null> = [];
    const dixie: DixieReadApi = {
      read(model) {
        seen.push(model);
        return true;
      },
    };
    expect(runtime.askDixie({ ice, events, dixie }).ok).toBe(true);
    expect(seen).toEqual([ice]);
    events.flush();
    expect(lines).toEqual([]);

    const away: DixieReadApi = { read: () => false };
    expect(runtime.askDixie({ ice, dixie: away }).fail).toBe('dixie-away');
  });
});
