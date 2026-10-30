import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/core/events';
import { pcg32 } from '../../src/core/rng';
import { createTrace } from '../../src/deck/Trace';
import type { ConstructInstance } from '../../src/world/Sector';
import {
  azimuthTo,
  createWatcherSim,
  DECOY_SECONDS,
  DECOY_TRACE_MUL,
  inSweepCone,
  kindForRegion,
  patrolYaw,
  placeWatchers,
  SYSOP_SPEC,
  TURING_SPEC,
  TURING_SWEEP_HZ,
  watcherBlip,
  watcherSpec,
  WATCHER_TRACE_RATE,
} from '../../src/world/watchers/Watcher';

const DT = 1 / 60;

function stubConstruct(over: Partial<ConstructInstance> = {}): ConstructInstance {
  return {
    id: 'c0',
    sx: 0,
    sz: 0,
    x: 64,
    y: 400,
    z: 64,
    kind: 'geodesic',
    spec: { kind: 'geodesic', frequency: 2, radius: 10 },
    color: 7,
    intensity: 1,
    importance: 0.5,
    rhythmBpm: 72,
    seed: 1,
    ...over,
  };
}

describe('M4.6 watcher cones and sweeps', () => {
  it('detects a target inside the Turing fan and not outside it', () => {
    const w = { x: 0, y: 8, z: 0 };
    const yaw = 0;
    const inFront = { x: 0, y: 8, z: 80 };
    const toTheSide = { x: 80, y: 8, z: 0 };
    const tooFar = { x: 0, y: 8, z: 400 };
    expect(inSweepCone(w, yaw, inFront, TURING_SPEC)).toBe(true);
    expect(inSweepCone(w, yaw, toTheSide, TURING_SPEC)).toBe(false);
    expect(inSweepCone(w, yaw, tooFar, TURING_SPEC)).toBe(false);
    expect(watcherSpec('turing').hz).toBe(TURING_SWEEP_HZ);
    expect(watcherSpec('sysop')).toBe(SYSOP_SPEC);
  });

  it('raises trace at 6%/s while exposed and not when clear', () => {
    const trace = createTrace();
    const sim = createWatcherSim({
      watchers: [{ x: 0, y: 8, z: 0, kind: 'turing', yaw0: 0 }],
      trace,
      player: { x: 0, y: 8, z: 80 },
    });
    expect(sim.exposed).toBe(true);
    // 0.25 Hz sweep leaves a 14° cone in ~0.15 s; sample 0.1 s still inside.
    for (let i = 0; i < 6; i++) sim.step(DT);
    expect(sim.exposed).toBe(true);
    expect(trace.value).toBeCloseTo(WATCHER_TRACE_RATE * 0.1, 5);

    sim.setPlayer(0, 8, 400);
    expect(sim.exposed).toBe(false);
    const held = trace.value;
    for (let i = 0; i < 60; i++) sim.step(DT);
    expect(trace.value).toBeCloseTo(held, 5);
  });

  it('DECOY diverts watchers for 8 s and halves trace gain', () => {
    const trace = createTrace();
    const sim = createWatcherSim({
      watchers: [{ x: 0, y: 8, z: 0, kind: 'turing', yaw0: 0 }],
      trace,
      player: { x: 0, y: 8, z: 80 },
    });
    const lure = sim.dropLure({ x: 90, y: 8, z: 0 }, DECOY_SECONDS, DECOY_TRACE_MUL);
    expect(lure.traceMul).toBe(0.5);
    expect(sim.lureRemaining).toBe(DECOY_SECONDS);
    const yawAtDrop = sim.states[0]!.yaw;
    for (let i = 0; i < 30; i++) sim.step(DT);
    expect(sim.states[0]!.lured).toBe(true);
    expect(sim.traceMul).toBe(DECOY_TRACE_MUL);
    const want = azimuthTo(sim.states[0]!, lure);
    expect(Math.abs(sim.states[0]!.yaw - yawAtDrop)).toBeGreaterThan(0.2);
    expect(Math.abs(sim.states[0]!.yaw - want)).toBeLessThan(0.6);
    expect(sim.exposed).toBe(false);

    sim.setPlayer(0, 8, 80);
    const before = trace.value;
    for (let i = 0; i < 60; i++) sim.step(DT);
    expect(trace.value - before).toBeCloseTo(0, 5);

    sim.clearLures();
    expect(sim.lureRemaining).toBe(0);
    sim.setTime(0);
    sim.setPlayer(0, 8, 80);
    expect(sim.exposed).toBe(true);
  });

  it('lure expires after its duration and patrol resumes', () => {
    const sim = createWatcherSim({
      watchers: [{ x: 0, y: 8, z: 0, kind: 'sysop', yaw0: 0.2 }],
      player: { x: 40, y: 8, z: 40 },
    });
    sim.dropLure({ x: -80, y: 8, z: 0 }, 1);
    sim.step(0.5);
    expect(sim.states[0]!.lured).toBe(true);
    sim.step(0.6);
    expect(sim.states[0]!.lured).toBe(false);
    expect(sim.lureRemaining).toBe(0);
    const t = sim.time;
    expect(sim.states[0]!.yaw).toBeCloseTo(patrolYaw(sim.states[0]!.yaw0, SYSOP_SPEC.hz, t), 5);
  });

  it('emits scanPulse on the rising edge of exposure', () => {
    const events = createEventBus();
    const pulses: number[] = [];
    events.on('scanPulse', () => pulses.push(1));
    const sim = createWatcherSim({
      watchers: [{ x: 0, y: 8, z: 0, kind: 'turing', yaw0: 0 }],
      events,
      player: { x: 80, y: 8, z: 0 },
    });
    events.flush();
    expect(pulses).toHaveLength(0);
    sim.setPlayer(0, 8, 80);
    sim.step(DT);
    events.flush();
    expect(pulses).toHaveLength(1);
    sim.step(DT);
    events.flush();
    expect(pulses).toHaveLength(1);
  });

  it('radar blips are watcher-kind in PPI space (0 = +X)', () => {
    const b = watcherBlip({ x: 40, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, 80);
    expect(b.kind).toBe('watcher');
    expect(b.angle).toBeCloseTo(0, 5);
    expect(b.radius).toBeCloseTo(0.5, 5);
  });

  it('places Turing watchers in EURO and none in VOID', () => {
    const euro = placeWatchers(pcg32(7), [stubConstruct()], 'EURO', 0.9);
    expect(euro.length).toBeGreaterThan(0);
    expect(euro.some((w) => w.kind === 'turing')).toBe(true);
    const empty = placeWatchers(pcg32(7), [stubConstruct()], 'VOID', 0.9);
    expect(empty).toHaveLength(0);
    expect(kindForRegion('ORBT', 0.1)).toBe('turing');
    expect(kindForRegion('BAMA', 0.9)).toBe('sysop');
    const a = placeWatchers(pcg32(3), [stubConstruct({ x: 8, z: 16 })], 'BAMA', 0.8);
    const b = placeWatchers(pcg32(3), [stubConstruct({ x: 8, z: 16 })], 'BAMA', 0.8);
    expect(a).toEqual(b);
  });
});
