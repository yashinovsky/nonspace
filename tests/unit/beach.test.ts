import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/loop';
import { createBeachSim } from '../../src/render/beach/sim';
import {
  bassDirection,
  bassDistance,
  BUNKER,
  checkerReveal,
  EXIT,
  LINDA,
  nearExit,
  nearLinda,
  resolveBunker,
  sandHeight,
  SPAWN,
  sunAngle,
  sunDir,
  sunElevation,
  updateStillness,
} from '../../src/render/beach/world';
import { createWalkController, emptyWalkInput } from '../../src/render/beach/walk';

describe('beach world', () => {
  it('sand is higher inland than toward the ocean', () => {
    expect(sandHeight(0, 8)).toBeGreaterThan(sandHeight(0, -12));
    expect(sandHeight(SPAWN.x, SPAWN.z)).toBeGreaterThan(0.1);
  });

  it('sun elevation goes negative at night and positive at noon', () => {
    const dawn = sunAngle(0);
    const noon = sunAngle(12);
    const dusk = sunAngle(24);
    const night = sunAngle(36);
    expect(sunElevation(dawn)).toBeCloseTo(0, 5);
    expect(sunElevation(noon)).toBeGreaterThan(0.9);
    expect(sunElevation(dusk)).toBeCloseTo(0, 5);
    expect(sunElevation(night)).toBeLessThan(-0.9);
    const d = sunDir(dawn);
    expect(d.z).toBeLessThan(0);
  });

  it('checkerboard reveal needs stillness and a downward gaze', () => {
    expect(checkerReveal(1, 1)).toBeGreaterThan(0.9);
    expect(checkerReveal(1, 0)).toBe(0);
    expect(checkerReveal(0, 1)).toBe(0);
    expect(updateStillness(0, 0, 5)).toBeGreaterThan(0.9);
    expect(updateStillness(1, 2, 5)).toBeLessThan(0.1);
  });

  it('bass direction from spawn points toward the exit', () => {
    const dir = bassDirection(SPAWN.x, SPAWN.z, { x: 0, y: 0, z: 0 });
    expect(dir.x).toBeGreaterThan(0.8);
    expect(bassDistance(EXIT.x, EXIT.z)).toBeLessThan(0.01);
    expect(nearExit(EXIT.x, EXIT.z)).toBe(true);
    expect(nearLinda(LINDA.x, LINDA.z)).toBe(true);
    expect(nearExit(SPAWN.x, SPAWN.z)).toBe(false);
  });

  it('bunker AABB pushes the player out except at the ocean door', () => {
    const inside = resolveBunker(BUNKER.x, BUNKER.z, 0.38);
    expect(Math.hypot(inside.x - BUNKER.x, inside.z - BUNKER.z)).toBeGreaterThan(2);
    const door = resolveBunker(-14.2, 13.2, 0.38);
    expect(door.z).toBeCloseTo(13.2, 5);
  });
});

describe('beach walk', () => {
  it('walks look-relative and stays on the sand', () => {
    const walk = createWalkController();
    const input = emptyWalkInput();
    const z0 = walk.pose.z;
    input.thrust = 1;
    for (let i = 0; i < 60; i++) walk.step(input, SIM_DT);
    expect(walk.pose.z).toBeLessThan(z0);
    expect(walk.pose.y).toBeGreaterThan(sandHeight(walk.pose.x, walk.pose.z));
    expect(walk.speed).toBeGreaterThan(1);
  });

  it('does not walk through the bunker', () => {
    const walk = createWalkController();
    walk.pose.x = BUNKER.x;
    walk.pose.z = BUNKER.z;
    walk.step(emptyWalkInput(), SIM_DT);
    const d = Math.hypot(walk.pose.x - BUNKER.x, walk.pose.z - BUNKER.z);
    expect(d).toBeGreaterThan(2);
  });
});

describe('beach sim choices', () => {
  it('following the bass to the exit leaves the construct', () => {
    const sim = createBeachSim();
    sim.setPose(EXIT.x, EXIT.z);
    const pulse = sim.step(SIM_DT);
    expect(pulse.choice).toBe('leave');
    expect(sim.phase).toBe('left');
  });

  it('engage near Linda starts the stay path and Ending B', () => {
    const sim = createBeachSim();
    sim.setPose(LINDA.x + 0.4, LINDA.z + 0.4);
    sim.sitPressed = true;
    const pulse = sim.step(SIM_DT);
    expect(pulse.choice).toBe('stay');
    expect(sim.phase).toBe('sitting');
    const end = sim.forceStay();
    expect(sim.phase).toBe('endingB');
    expect(end.choice ?? pulse.choice).toBe('stay');
  });

  it('still downward gaze raises the checkerboard reveal', () => {
    const sim = createBeachSim();
    sim.walk.pose.pitch = -1.2;
    sim.walk.prev.pitch = -1.2;
    sim.input.thrust = 0;
    for (let i = 0; i < 180; i++) sim.step(SIM_DT);
    expect(sim.reveal).toBeGreaterThan(0.45);
    expect(-sim.walk.forward.y).toBeGreaterThan(0.8);
  });

  it('sun angle advances with time', () => {
    const sim = createBeachSim();
    const a0 = sim.sunAngle;
    for (let i = 0; i < 120; i++) sim.step(SIM_DT);
    expect(sim.sunAngle).toBeGreaterThan(a0);
  });
});
