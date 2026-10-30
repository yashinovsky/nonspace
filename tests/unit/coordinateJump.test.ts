import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/loop';
import {
  createCoordinateJump,
  jumpArrival,
  jumpBlockReason,
  jumpFailMessage,
  jumpStreakDuration,
  JUMP_ALIGN,
  JUMP_STANDOFF,
  JUMP_STREAK_MAX,
  JUMP_STREAK_MIN,
} from '../../src/player/CoordinateJump';
import { createFlightController } from '../../src/player/FlightController';
import { matrixCoordToWorld, parseMatrixCoord } from '../../src/world/coords';
import type { SectorData } from '../../src/world/Sector';
import {
  createDeferredBackend,
  createSectorStreamer,
  neededSectors,
} from '../../src/world/SectorStreamer';

const CHIBA = parseMatrixCoord('CHBA 0412.90 / 0180.20 / 0160')!;

function stubSector(sx: number, sz: number, worldSeed: number): SectorData {
  return {
    sx,
    sz,
    worldSeed,
    region: 'BAMA',
    density: 0,
    constructs: [],
    clusters: [],
    traffic: [],
    watchers: [],
    contentHash: sx * 1000 + sz,
  };
}

describe('M2.6 coordinate jump', () => {
  it('maps travel onto a 1.5–3 s streak', () => {
    expect(jumpStreakDuration(0)).toBe(JUMP_STREAK_MIN);
    expect(jumpStreakDuration(500)).toBeGreaterThanOrEqual(JUMP_STREAK_MIN);
    expect(jumpStreakDuration(500)).toBeLessThanOrEqual(JUMP_STREAK_MAX);
    expect(jumpStreakDuration(200_000)).toBe(JUMP_STREAK_MAX);
  });

  it('arrives at rest 300 u from the target after 1.5–3 s of streak', () => {
    const flight = createFlightController({
      pose: { x: 0, y: 120, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 },
    });
    const jump = createCoordinateJump({ flight });
    const world = matrixCoordToWorld(CHIBA);
    const land = jumpArrival(flight.pose, world);
    expect(land.travel).toBeGreaterThan(1000);
    const started = jump.start(CHIBA);
    expect(started).toEqual({ ok: true });
    expect(jump.streakDuration).toBeGreaterThanOrEqual(JUMP_STREAK_MIN);
    expect(jump.streakDuration).toBeLessThanOrEqual(JUMP_STREAK_MAX);
    const steps = Math.ceil(jump.duration / SIM_DT) + 2;
    for (let i = 0; i < steps; i++) jump.step(SIM_DT);
    expect(jump.phase).toBe('done');
    expect(jump.active).toBe(false);
    const p = flight.pose;
    const dist = Math.hypot(world.x - p.x, world.y - p.y, world.z - p.z);
    expect(dist).toBeCloseTo(JUMP_STANDOFF, 4);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.vz).toBe(0);
    expect(flight.telemetry.speed).toBe(0);
  });

  it('blocks in grip, inside a core, and at trace 100%', () => {
    const flight = createFlightController();
    let gripped = false;
    let inCore = false;
    let trace = 0;
    const jump = createCoordinateJump({
      flight,
      gripped: () => gripped,
      inCore: () => inCore,
      trace: () => trace,
    });
    gripped = true;
    expect(jump.start(CHIBA)).toEqual({ ok: false, reason: 'grip' });
    expect(jumpFailMessage('grip')).toBe('BLOCKED GRIP');
    gripped = false;
    inCore = true;
    expect(jump.start(CHIBA)).toEqual({ ok: false, reason: 'core' });
    inCore = false;
    trace = 100;
    expect(jump.start(CHIBA)).toEqual({ ok: false, reason: 'trace' });
    expect(jumpBlockReason({ trace: 100 })).toBe('trace');
    expect(jump.phase).toBe('idle');
  });

  it('preloads destination sectors during the streak so they are ready on arrival', async () => {
    const backend = createDeferredBackend(stubSector);
    const streamer = createSectorStreamer({ backend, worldSeed: 1 });
    const flight = createFlightController({
      pose: { x: 148 * 1024, y: 120, z: 72 * 1024, vx: 0, vy: 0, vz: 0 },
    });
    streamer.update(flight.pose.x, flight.pose.y, flight.pose.z);
    backend.flush(32);
    await Promise.resolve();
    streamer.update(flight.pose.x, flight.pose.y, flight.pose.z);

    let preloads = 0;
    const jump = createCoordinateJump({
      flight,
      preload: (x, _y, z) => {
        preloads += 1;
        streamer.preload(x, z);
      },
      arrive: (x, y, z) => streamer.update(x, y, z),
    });
    expect(jump.start(CHIBA).ok).toBe(true);
    const dest = jump.arrival!;
    expect(streamer.readyAround(dest.x, dest.z)).toBe(false);

    const mid = JUMP_ALIGN + jump.streakDuration * 0.5;
    while (jump.elapsed < mid) {
      jump.step(SIM_DT);
      backend.flush(8);
      await Promise.resolve();
      streamer.preload(dest.x, dest.z);
    }
    expect(preloads).toBeGreaterThan(3);
    expect(neededSectors(0, 0).length).toBe(25);

    while (jump.phase !== 'done') {
      jump.step(SIM_DT);
      backend.flush(8);
      await Promise.resolve();
      streamer.preload(dest.x, dest.z);
    }
    expect(streamer.readyAround(dest.x, dest.z)).toBe(true);
    streamer.dispose();
  });
});
