/**
 * Berne tendril (M7.6 / book ch. 9): a stippled gray circle forms, bulges
 * into a sphere, then chases down a shaft. Additive points on black — not neon.
 */

import type { Vec3 } from '../core/math/vec3';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';
import { createPointBatch, type GpuPointBatch } from '../render/points/PointBatch';
import type { Renderer } from '../render/Renderer';

export const TENDRIL_CIRCLE_S = 1.2;
export const TENDRIL_BULGE_S = 1.4;
export const TENDRIL_CHASE_S = 2.2;
export const TENDRIL_DURATION = TENDRIL_CIRCLE_S + TENDRIL_BULGE_S + TENDRIL_CHASE_S;
export const TENDRIL_RADIUS = 18;
export const TENDRIL_SHAFT = 220;
const SPHERE_N = 96;
const RING_N = 32;
const SHAFT_RINGS = 10;
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export type TendrilPhase = 'idle' | 'circle' | 'sphere' | 'chase' | 'done';

export interface TendrilSample {
  phase: TendrilPhase;
  /** 0..1 within the current phase. */
  u: number;
  /** 0..1 overall. */
  t01: number;
  radius: number;
  bulge: number;
  chase: number;
  done: boolean;
}

export function tendrilSample(elapsed: number): TendrilSample {
  const t = elapsed < 0 ? 0 : elapsed;
  if (!(t > 0)) {
    return { phase: 'idle', u: 0, t01: 0, radius: 0, bulge: 0, chase: 0, done: false };
  }
  if (t < TENDRIL_CIRCLE_S) {
    const u = t / TENDRIL_CIRCLE_S;
    return {
      phase: 'circle',
      u,
      t01: t / TENDRIL_DURATION,
      radius: u,
      bulge: 0,
      chase: 0,
      done: false,
    };
  }
  if (t < TENDRIL_CIRCLE_S + TENDRIL_BULGE_S) {
    const u = (t - TENDRIL_CIRCLE_S) / TENDRIL_BULGE_S;
    return {
      phase: 'sphere',
      u,
      t01: t / TENDRIL_DURATION,
      radius: 1,
      bulge: u,
      chase: 0,
      done: false,
    };
  }
  if (t < TENDRIL_DURATION) {
    const u = (t - TENDRIL_CIRCLE_S - TENDRIL_BULGE_S) / TENDRIL_CHASE_S;
    return {
      phase: 'chase',
      u,
      t01: t / TENDRIL_DURATION,
      radius: 1,
      bulge: 1,
      chase: u,
      done: false,
    };
  }
  return { phase: 'done', u: 1, t01: 1, radius: 1, bulge: 1, chase: 1, done: true };
}

function norm(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z);
  if (!(l > 1e-8)) return { x: 0, y: -1, z: 0 };
  return { x: x / l, y: y / l, z: z / l };
}

function basis(axis: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = norm(axis.x, axis.y, axis.z);
  const ax = Math.abs(w.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cx = ax.y * w.z - ax.z * w.y;
  const cy = ax.z * w.x - ax.x * w.z;
  const cz = ax.x * w.y - ax.y * w.x;
  const u = norm(cx, cy, cz);
  return {
    u,
    v: { x: w.y * u.z - w.z * u.y, y: w.z * u.x - w.x * u.z, z: w.x * u.y - w.y * u.x },
    w,
  };
}

export interface Tendril {
  readonly elapsed: number;
  readonly phase: TendrilPhase;
  readonly sample: TendrilSample;
  readonly started: boolean;
  readonly done: boolean;
  origin: Vec3;
  axis: Vec3;
  start(): void;
  seek(time: number): void;
  update(dt: number): void;
  paint(): void;
  dispose(): void;
}

export function createTendril(renderer: Renderer, origin: Vec3, axis?: Vec3): Tendril {
  const points: GpuPointBatch = createPointBatch({
    capacity: SPHERE_N + SHAFT_RINGS * RING_N,
    palette: renderer.palette,
  });
  points.object.name = 'BerneTendril';
  renderer.scenes.matrix.add(points.object);

  const shaft: BeamBatchGpu = createBeamBatch(renderer.palette, {
    capacity: SHAFT_RINGS * RING_N + 2,
    style: { fogDensity: 0.0002, fogStart: 40, sigma: 0.55, dwell: 0.15, dwellSigma: 1.2 },
  });
  shaft.object.name = 'BerneShaft';
  renderer.scenes.matrix.add(shaft.object);

  let elapsed = 0;
  let started = false;
  let sample = tendrilSample(0);
  let pos = { x: origin.x, y: origin.y, z: origin.z };
  let dir = axis ? { ...axis } : { x: 0, y: -1, z: 0 };

  const draw = (): void => {
    sample = tendrilSample(started ? elapsed : 0);
    const live = started && sample.phase !== 'idle';
    points.object.visible = live;
    shaft.object.visible = live;
    if (!live) {
      points.beginDynamic();
      points.endDynamic();
      shaft.beginDynamic();
      shaft.endDynamic();
      return;
    }
    const { u, v, w } = basis(dir);
    const R = TENDRIL_RADIUS * Math.max(0.08, sample.radius);
    const chase = sample.chase * TENDRIL_SHAFT;
    const ox = pos.x + w.x * chase;
    const oy = pos.y + w.y * chase;
    const oz = pos.z + w.z * chase;
    const inten = 0.55 + 0.35 * sample.radius;
    const size = 2.4 + 1.2 * sample.bulge;

    points.beginDynamic();
    const n = sample.phase === 'circle' ? RING_N : SPHERE_N;
    for (let i = 0; i < n; i++) {
      let lx: number;
      let ly: number;
      let lz: number;
      if (sample.phase === 'circle' || (sample.phase === 'sphere' && sample.bulge < 1)) {
        const ang = (TAU * i) / RING_N;
        const cx = Math.cos(ang) * R;
        const cy = Math.sin(ang) * R;
        const sx = fibX(i, SPHERE_N) * R;
        const sy = fibY(i, SPHERE_N) * R;
        const sz = fibZ(i, SPHERE_N) * R;
        const k = sample.phase === 'circle' ? 0 : sample.bulge;
        lx = cx * (1 - k) + sx * k;
        ly = sy * k;
        lz = cy * (1 - k) + sz * k;
      } else {
        lx = fibX(i, SPHERE_N) * R;
        ly = fibY(i, SPHERE_N) * R;
        lz = fibZ(i, SPHERE_N) * R;
      }
      points.push(
        {
          x: ox + u.x * lx + v.x * lz + w.x * ly,
          y: oy + u.y * lx + v.y * lz + w.y * ly,
          z: oz + u.z * lx + v.z * lz + w.z * ly,
        },
        Beam.GRID,
        inten,
        size,
      );
    }
    for (let r = 0; r < SHAFT_RINGS; r++) {
      const along = ((r + 1) / (SHAFT_RINGS + 1)) * TENDRIL_SHAFT;
      const ringR = TENDRIL_RADIUS * (0.35 + 0.25 * (1 - r / SHAFT_RINGS));
      for (let i = 0; i < RING_N; i += 2) {
        const ang = (TAU * i) / RING_N;
        const px = Math.cos(ang) * ringR;
        const pz = Math.sin(ang) * ringR;
        points.push(
          {
            x: pos.x + u.x * px + v.x * pz + w.x * along,
            y: pos.y + u.y * px + v.y * pz + w.y * along,
            z: pos.z + u.z * px + v.z * pz + w.z * along,
          },
          Beam.GRID,
          0.28,
          1.8,
        );
      }
    }
    points.endDynamic();

    shaft.beginDynamic();
    shaft.push(
      pos,
      {
        x: pos.x + w.x * TENDRIL_SHAFT,
        y: pos.y + w.y * TENDRIL_SHAFT,
        z: pos.z + w.z * TENDRIL_SHAFT,
      },
      Beam.GRID,
      0.22,
      1.1,
      BeamFlag.NO_FOG,
    );
    shaft.endDynamic();
  };

  const api: Tendril = {
    get elapsed() {
      return elapsed;
    },
    get phase() {
      return sample.phase;
    },
    get sample() {
      return sample;
    },
    get started() {
      return started;
    },
    get done() {
      return sample.done;
    },
    get origin() {
      return pos;
    },
    set origin(next) {
      pos = { x: next.x, y: next.y, z: next.z };
    },
    get axis() {
      return dir;
    },
    set axis(next) {
      dir = { x: next.x, y: next.y, z: next.z };
    },
    start() {
      started = true;
      elapsed = 0;
      sample = tendrilSample(0);
      draw();
    },
    seek(time) {
      started = true;
      elapsed = Math.max(0, time);
      draw();
    },
    update(dt) {
      if (!started || sample.done) return;
      elapsed += Math.max(0, dt);
      draw();
    },
    paint: draw,
    dispose() {
      renderer.scenes.matrix.remove(points.object);
      renderer.scenes.matrix.remove(shaft.object);
      points.dispose();
      shaft.dispose();
    },
  };
  draw();
  return api;
}

function fibY(i: number, n: number): number {
  if (n <= 1) return 0;
  return 1 - (i / (n - 1)) * 2;
}

function fibR(i: number, n: number): number {
  const y = fibY(i, n);
  return Math.sqrt(Math.max(0, 1 - y * y));
}

function fibX(i: number, n: number): number {
  return Math.cos(GOLDEN * i) * fibR(i, n);
}

function fibZ(i: number, n: number): number {
  return Math.sin(GOLDEN * i) * fibR(i, n);
}
