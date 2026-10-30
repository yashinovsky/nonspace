import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { SIM_DT } from '../../src/core/loop';
import { createCameraRig } from '../../src/player/CameraRig';
import {
  aabbHull,
  createCollisionWorld,
  createHit,
  queryHull,
  sphereHull,
} from '../../src/player/Collision';
import {
  DEG,
  FLIGHT_DEFAULTS,
  createFlightController,
  type FlightController,
} from '../../src/player/FlightController';
import type { InputFrame } from '../../src/input/Input';

function stubFrame(
  over: Partial<Omit<InputFrame, 'down' | 'pressed' | 'released' | 'held'>> & {
    boost?: boolean;
  } = {},
): InputFrame {
  const boost = over.boost ?? false;
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
    down: (a) => a === 'boost' && boost,
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
    ...over,
  };
}

function step(flight: FlightController, n: number, frame: InputFrame, dt = SIM_DT): void {
  for (let i = 0; i < n; i++) flight.step(frame, dt);
}

function snap(flight: FlightController) {
  const p = flight.pose;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    bank: p.bank,
    fov: p.fov,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz,
  };
}

describe('§3.3 flight parameters', () => {
  it('defaults match the plan table', () => {
    expect(FLIGHT_DEFAULTS.cruiseMaxSpeed).toBe(80);
    expect(FLIGHT_DEFAULTS.boostMaxSpeed).toBe(600);
    expect(FLIGHT_DEFAULTS.cruiseAccel).toBe(120);
    expect(FLIGHT_DEFAULTS.boostAccel).toBe(900);
    expect(FLIGHT_DEFAULTS.dragHalfLife).toBe(0.6);
    expect(FLIGHT_DEFAULTS.pitchClampDeg).toBe(85);
    expect(FLIGHT_DEFAULTS.bankMaxDeg).toBe(6);
    expect(FLIGHT_DEFAULTS.autoLevelHalfLife).toBe(0.3);
    expect(FLIGHT_DEFAULTS.fovBase).toBe(75);
    expect(FLIGHT_DEFAULTS.fovKick).toBe(12);
    expect(FLIGHT_DEFAULTS.gridAssist).toBe(true);
    expect(FLIGHT_DEFAULTS.gridAssistConeDeg).toBe(15);
    expect(FLIGHT_DEFAULTS.gridAssistRateDeg).toBe(30);
    expect(FLIGHT_DEFAULTS.hullSpringRadius).toBe(20);
    expect(FLIGHT_DEFAULTS.altitudeCeiling).toBe(12_000);
  });
});

describe('FlightController at fixed dt', () => {
  it('integrates deterministically over 3 s of mixed input', () => {
    const script = (tick: number): InputFrame => {
      if (tick < 60) return stubFrame({ thrust: 1 });
      if (tick < 90) return stubFrame({ thrust: 1, boost: true, lookX: 0.2 });
      if (tick < 120) return stubFrame({ vertical: 1, strafe: -0.5 });
      return stubFrame({ mouseDx: 4, mouseDy: -2 });
    };
    const run = (): ReturnType<typeof snap> => {
      const f = createFlightController();
      for (let i = 0; i < 180; i++) f.step(script(i), SIM_DT);
      return snap(f);
    };
    expect(run()).toEqual(run());
  });

  it('cruise thrust caps at 80 u/s and boost climbs far past cruise', () => {
    const cruise = createFlightController();
    step(cruise, 180, stubFrame({ thrust: 1 }));
    expect(cruise.telemetry.speed).toBeGreaterThan(75);
    expect(cruise.telemetry.speed).toBeLessThanOrEqual(80 + 1e-6);

    const boost = createFlightController();
    step(boost, 180, stubFrame({ thrust: 1, boost: true }));
    expect(boost.telemetry.speed).toBeGreaterThan(400);
    expect(boost.telemetry.speed).toBeLessThanOrEqual(600 + 1e-6);
  });

  it('exponential drag has a 0.6 s half-life when there is no thrust', () => {
    const f = createFlightController();
    f.setPose({ vx: 80, vy: 0, vz: 0 });
    step(f, 36, stubFrame(), SIM_DT); // 36 * 1/60 = 0.6 s
    expect(f.telemetry.speed).toBeCloseTo(40, 5);
  });

  it('clamps pitch to ±85° and has no roll input', () => {
    const f = createFlightController();
    step(f, 10, stubFrame({ mouseDy: 50_000 }));
    expect(f.pose.pitch).toBeCloseTo(85 * DEG, 8);
    step(f, 10, stubFrame({ mouseDy: -50_000 }));
    expect(f.pose.pitch).toBeCloseTo(-85 * DEG, 8);
    expect(f.pose.bank).toBe(0);
  });

  it('grid assist snaps a 10° heading onto the axis at 30°/s, and can be disabled', () => {
    const on = createFlightController();
    on.setPose({ yaw: 10 * DEG, pitch: 0 });
    step(on, 60, stubFrame());
    expect(Math.abs(on.pose.yaw)).toBeLessThan(0.01);
    expect(on.telemetry.gridAssistActive).toBe(true);

    const off = createFlightController();
    off.params.gridAssist = false;
    off.setPose({ yaw: 10 * DEG, pitch: 0 });
    step(off, 60, stubFrame());
    expect(off.pose.yaw).toBeCloseTo(10 * DEG, 8);
    expect(off.telemetry.gridAssistActive).toBe(false);

    const outside = createFlightController();
    outside.setPose({ yaw: 20 * DEG, pitch: 0 });
    step(outside, 60, stubFrame());
    expect(outside.pose.yaw).toBeCloseTo(20 * DEG, 5);
    expect(outside.telemetry.gridAssistActive).toBe(false);
  });

  it('banks visually with yaw rate up to 6° and auto-levels; FOV kicks with speed', () => {
    const f = createFlightController();
    step(f, 30, stubFrame({ lookX: 1 }));
    expect(Math.abs(f.pose.bank * (180 / Math.PI))).toBeGreaterThan(1);
    expect(Math.abs(f.pose.bank * (180 / Math.PI))).toBeLessThanOrEqual(6 + 1e-4);
    const banked = Math.abs(f.pose.bank);
    step(f, 90, stubFrame());
    expect(Math.abs(f.pose.bank)).toBeLessThan(banked * 0.3);

    const g = createFlightController();
    step(g, 180, stubFrame({ thrust: 1, boost: true }));
    expect(g.pose.fov).toBeGreaterThan(80);
    expect(g.pose.fov).toBeLessThanOrEqual(87 + 0.5);

    g.params.fovKickEnabled = false;
    g.params.banking = false;
    step(g, 60, stubFrame({ lookX: 1, thrust: 1, boost: true }));
    expect(g.pose.fov).toBeCloseTo(75, 0);
    expect(Math.abs(g.pose.bank)).toBeLessThan(0.01);
  });

  it('reduceMotion disables banking and FOV kick', () => {
    const f = createFlightController();
    step(f, 120, stubFrame({ thrust: 1, boost: true, lookX: 1 }), SIM_DT);
    // re-run with the flag
    const g = createFlightController();
    for (let i = 0; i < 120; i++) {
      g.step(stubFrame({ thrust: 1, boost: true, lookX: 1 }), SIM_DT, { reduceMotion: true });
    }
    expect(g.pose.bank).toBe(0);
    expect(g.pose.fov).toBeCloseTo(75, 0);
  });

  it('soft ceiling above 12,000 u pushes down and makes controls sluggish', () => {
    const f = createFlightController();
    f.setPose({ x: 0, y: 15_000, z: 0, vy: 0 });
    const y0 = f.pose.y;
    step(f, 120, stubFrame());
    expect(f.pose.y).toBeLessThan(y0);
    expect(f.pose.y).toBeGreaterThan(12_000); // soft: not teleported to the line
    expect(f.telemetry.ceilingActive).toBe(true);
    expect(f.telemetry.controlScale).toBeLessThan(1);

    const low = createFlightController();
    const high = createFlightController();
    high.setPose({ y: 15_000 });
    step(low, 60, stubFrame({ thrust: 1 }));
    step(high, 60, stubFrame({ thrust: 1 }));
    expect(Math.abs(high.pose.vz)).toBeLessThan(Math.abs(low.pose.vz) * 0.8);
  });

  it('cannot enter a hull and is pushed out smoothly from inside', () => {
    const world = createCollisionWorld([sphereHull('s', 'construct', 0, 0, 0, 10)]);
    const flyer = createFlightController({ collision: world });
    flyer.setPose({ x: 80, y: 0, z: 0, yaw: -Math.PI / 2, vx: -80 });
    let minGap = Infinity;
    for (let i = 0; i < 180; i++) {
      flyer.step(stubFrame({ thrust: 1 }), SIM_DT);
      const d = Math.hypot(flyer.pose.x, flyer.pose.y, flyer.pose.z);
      minGap = Math.min(minGap, d - 10);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-4);
    }
    expect(minGap).toBeLessThan(20); // entered the spring zone
    expect(minGap).toBeGreaterThanOrEqual(-1e-4);

    const trapped = createFlightController({
      collision: createCollisionWorld([sphereHull('s', 'ice', 0, 0, 0, 40)]),
    });
    trapped.setPose({ x: 0, y: 0, z: 0 });
    const d0 = Math.hypot(trapped.pose.x, trapped.pose.y, trapped.pose.z);
    step(trapped, 4, stubFrame());
    const d1 = Math.hypot(trapped.pose.x, trapped.pose.y, trapped.pose.z);
    expect(d1).toBeGreaterThan(d0);
    expect(d1).toBeLessThan(40); // still inside: push is spread across ticks
    step(trapped, 90, stubFrame());
    const dEnd = Math.hypot(trapped.pose.x, trapped.pose.y, trapped.pose.z);
    expect(dEnd).toBeGreaterThanOrEqual(40 - 1e-3);
    expect(dEnd).toBeLessThan(40 + 20 + 5);
    expect(trapped.lastHit.ice).toBe(true);
    expect(trapped.lastHit.gap).toBeLessThanOrEqual(20 + 1e-3);
  });
});

describe('Collision volumes', () => {
  it('reports signed gap for spheres and AABBs', () => {
    const hit = createHit();
    queryHull(0, 0, 30, sphereHull('a', 'construct', 0, 0, 0, 10), hit);
    expect(hit.gap).toBeCloseTo(20);
    expect(hit.inside).toBe(false);
    queryHull(0, 0, 0, sphereHull('a', 'ice', 0, 0, 0, 10), hit);
    expect(hit.inside).toBe(true);
    expect(hit.ice).toBe(true);
    expect(hit.gap).toBeCloseTo(-10);

    const box = aabbHull('b', 'construct', -5, -5, -5, 5, 5, 5);
    queryHull(20, 0, 0, box, hit);
    expect(hit.gap).toBeCloseTo(15);
    expect(hit.nx).toBeCloseTo(1);
    queryHull(0, 0, 0, box, hit);
    expect(hit.inside).toBe(true);
    expect(hit.gap).toBeCloseTo(-5);
  });
});

describe('CameraRig', () => {
  it('interpolates pose and writes yaw/pitch/bank/FOV onto a PerspectiveCamera', () => {
    const flight = createFlightController();
    flight.setPose({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 75 });
    flight.pose.x = 10;
    flight.pose.yaw = 0.4;
    flight.pose.pitch = 0.1;
    flight.pose.bank = 0.05;
    flight.pose.fov = 87;
    const cam = new PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const rig = createCameraRig({ camera: cam });
    rig.apply(flight, 0.5);
    expect(cam.position.x).toBeCloseTo(5);
    expect(cam.rotation.order).toBe('YXZ');
    expect(cam.rotation.y).toBeCloseTo(0.2);
    expect(cam.rotation.x).toBeCloseTo(0.05);
    expect(cam.rotation.z).toBeCloseTo(0.025);
    expect(cam.fov).toBeCloseTo(81);
  });
});
