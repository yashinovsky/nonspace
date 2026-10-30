import { describe, expect, it } from 'vitest';
import {
  constellationPulse,
  CORE_BPM,
  CORE_JACK_OUT_HOLD,
  CORE_STRATA_MAX,
  CORE_STRATA_MIN,
  CORE_TRACE_MUL,
  CORE_TRACE_RATE,
  createCoreInterior,
  DEFAULT_ICE_LAYERS,
  DEFAULT_REFREEZE_S,
  DOWNLOAD_HOLD_S,
  generateCore,
  layerFreeze,
  ROUTE_OUT_MAX_S,
  ROUTE_OUT_MIN_S,
  ROUTE_OUT_TRACE_SCRUB,
} from '../../src/breach/CoreInterior';
import { beatDuration } from '../../src/audio/music/Sequencer';
import { createEventBus } from '../../src/core/events';
import { SIM_DT } from '../../src/core/loop';

const DEF = { seed: 1, strata: 8, targetRecord: 'REC-0001', layers: 4 };

function atTarget(core: ReturnType<typeof createCoreInterior>) {
  const t = core.layout.target;
  return { x: t.cx, y: t.cy, z: t.cz };
}

describe('core generation', () => {
  it('is deterministic by seed and clamps strata to 6–12', () => {
    const a = generateCore(DEF);
    const b = generateCore(DEF);
    expect(a.strataCount).toBe(8);
    expect(a.strataCount).toBeGreaterThanOrEqual(CORE_STRATA_MIN);
    expect(a.strataCount).toBeLessThanOrEqual(CORE_STRATA_MAX);
    expect(a.target.code).toBe('REC-0001');
    expect(a.target.kind).toBe('target');
    expect(a.decoys.length).toBeGreaterThan(0);
    expect(a.decoys.every((d) => d.kind === 'decoy')).toBe(true);
    expect(Array.from(a.target.points)).toEqual(Array.from(b.target.points));
    expect(a.records.map((r) => `${r.x},${r.y},${r.z},${r.code}`)).toEqual(
      b.records.map((r) => `${r.x},${r.y},${r.z},${r.code}`),
    );

    const other = generateCore({ ...DEF, seed: 2 });
    expect(Array.from(other.target.points)).not.toEqual(Array.from(a.target.points));

    expect(generateCore({ ...DEF, strata: 2 }).strataCount).toBe(CORE_STRATA_MIN);
    expect(generateCore({ ...DEF, strata: 99 }).strataCount).toBe(CORE_STRATA_MAX);
  });
});

describe('constellation pulse', () => {
  it('peaks on-beat for the target and off-beat for decoys', () => {
    const beat = beatDuration(CORE_BPM);
    expect(constellationPulse(0, CORE_BPM, false)).toBeCloseTo(1, 5);
    expect(constellationPulse(0, CORE_BPM, true)).toBeCloseTo(0, 5);
    expect(constellationPulse(beat * 0.5, CORE_BPM, false)).toBeCloseTo(0, 5);
    expect(constellationPulse(beat * 0.5, CORE_BPM, true)).toBeCloseTo(1, 5);

    const core = createCoreInterior({ def: DEF });
    core.setTime(0);
    expect(core.targetPulse).toBeCloseTo(1, 5);
    expect(core.decoyPulse).toBeCloseTo(0, 5);
    core.setTime(beat * 0.5);
    expect(core.targetPulse).toBeCloseTo(0, 5);
    expect(core.decoyPulse).toBeCloseTo(1, 5);
  });
});

describe('download hold', () => {
  it('emits downloadProgress and finishes after the hold', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.on('downloadProgress', (e) => {
      seen.push(e.value);
      expect(e.targetId).toBe('REC-0001');
    });
    const core = createCoreInterior({ events: bus, def: DEF });
    const player = atTarget(core);
    expect(core.isNearTarget(player)).toBe(true);

    const half = DOWNLOAD_HOLD_S * 0.5;
    core.step(half, { downloadHeld: true, player });
    bus.flush();
    expect(core.phase).toBe('download');
    expect(core.download).toBeCloseTo(0.5, 5);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(1);

    core.step(half + SIM_DT, { downloadHeld: true, player });
    bus.flush();
    expect(core.downloaded).toBe(true);
    expect(core.phase).toBe('exfil');
    expect(seen.at(-1)).toBe(1);

    const before = core.trace.value;
    core.step(1, { downloadHeld: false, player });
    expect(core.trace.value).toBeGreaterThan(before);
    expect(core.trace.value - before).toBeCloseTo(CORE_TRACE_RATE * CORE_TRACE_MUL, 5);
  });

  it('cancels progress when the hold is released early', () => {
    const bus = createEventBus();
    const core = createCoreInterior({ events: bus, def: DEF });
    const player = atTarget(core);
    core.step(1, { downloadHeld: true, player });
    bus.flush();
    expect(core.download).toBeGreaterThan(0);
    core.step(SIM_DT, { downloadHeld: false, player });
    bus.flush();
    expect(core.download).toBe(0);
    expect(core.phase).toBe('hunt');
  });
});

describe('exfil', () => {
  it('route-out scrubs 30% trace and re-freezes layers over the configured time', () => {
    const core = createCoreInterior({ def: { ...DEF, refreeze: DEFAULT_REFREEZE_S } });
    core.trace.set(80);
    core.completeDownload();
    expect(core.phase).toBe('exfil');
    expect(core.startRouteOut()).toBe(true);
    expect(core.phase).toBe('routeOut');
    expect(core.trace.value).toBeCloseTo(80 * (1 - ROUTE_OUT_TRACE_SCRUB), 5);

    expect(DEFAULT_REFREEZE_S).toBeGreaterThanOrEqual(ROUTE_OUT_MIN_S);
    expect(DEFAULT_REFREEZE_S).toBeLessThanOrEqual(ROUTE_OUT_MAX_S);
    expect(core.layerCount).toBe(DEFAULT_ICE_LAYERS);

    const span = DEFAULT_REFREEZE_S / DEFAULT_ICE_LAYERS;
    expect(layerFreeze(span, DEFAULT_REFREEZE_S, 0, DEFAULT_ICE_LAYERS)).toBeCloseTo(1, 5);
    expect(layerFreeze(span * 0.5, DEFAULT_REFREEZE_S, 0, DEFAULT_ICE_LAYERS)).toBeCloseTo(0.5, 5);
    expect(layerFreeze(span * 0.5, DEFAULT_REFREEZE_S, 1, DEFAULT_ICE_LAYERS)).toBeCloseTo(0, 5);

    core.step(span, { downloadHeld: false });
    expect(core.layerFreeze(0)).toBeCloseTo(1, 5);
    expect(core.frozenLayers).toBe(1);

    core.step(DEFAULT_REFREEZE_S, { downloadHeld: false });
    expect(core.phase).toBe('done');
    expect(core.frozenLayers).toBe(DEFAULT_ICE_LAYERS);
    expect(core.freezeProgress).toBe(1);
  });

  it('jack-out after download holds for 1 s and ticks heat when trace is hot', () => {
    const bus = createEventBus();
    const reasons: string[] = [];
    bus.on('jackOut', (e) => reasons.push(e.reason));
    const core = createCoreInterior({ events: bus, def: DEF });
    core.trace.set(70);
    core.completeDownload();
    expect(core.startJackOut()).toBe(true);
    bus.flush();
    expect(core.phase).toBe('jackOut');
    expect(core.heat.value).toBe(1);
    expect(reasons).toEqual(['player']);
    expect(CORE_JACK_OUT_HOLD).toBe(1);
  });
});
