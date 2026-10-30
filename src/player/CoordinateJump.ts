/**
 * Coordinate jump ("the flip", plan §3.4 / M2.6). Pure sim: no DOM, no Three.
 * Writes the existing FlightController pose via `setPose` — does not rewrite
 * or step the flight model. Destination sectors are the caller's job
 * (`preload` during align+streak, `arrive` on landing).
 */

import { poseFromForward, wrapAngle, type FlightController } from './FlightController';
import { matrixCoordToWorld, type MatrixCoord } from '../world/coords';

export const JUMP_ALIGN = 0.4;
export const JUMP_STREAK_MIN = 1.5;
export const JUMP_STREAK_MAX = 3.0;
export const JUMP_STANDOFF = 300;
export const JUMP_FOV_KICK = 25;
export const JUMP_FOV_KICK_REDUCED = 8;
export const JUMP_PITCH_RISE = 0.12;
export const JUMP_PITCH_RISE_REDUCED = 0.04;

export type JumpPhase = 'idle' | 'align' | 'streak' | 'done';
export type JumpFail = 'grip' | 'core' | 'trace' | 'busy';

export function jumpFailMessage(reason: JumpFail): string {
  if (reason === 'grip') return 'BLOCKED GRIP';
  if (reason === 'core') return 'BLOCKED CORE';
  if (reason === 'trace') return 'BLOCKED TRACE';
  return 'JUMP BUSY';
}

export function jumpBlockReason(opts: {
  gripped?: boolean;
  inCore?: boolean;
  trace?: number;
}): JumpFail | null {
  if (opts.gripped) return 'grip';
  if (opts.inCore) return 'core';
  if ((opts.trace ?? 0) >= 100) return 'trace';
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Map travel distance (u) onto the 1.5–3 s streak window. */
export function jumpStreakDuration(travelU: number): number {
  const d = Math.max(0, travelU);
  const t = Math.log1p(d / 2048) / Math.log1p(80_000 / 2048);
  return JUMP_STREAK_MIN + (JUMP_STREAK_MAX - JUMP_STREAK_MIN) * clamp(t, 0, 1);
}

export interface JumpArrival {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dx: number;
  dy: number;
  dz: number;
  travel: number;
}

/** Resting pose 300 u from the target, looking at it. */
export function jumpArrival(
  from: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  standoff = JUMP_STANDOFF,
): JumpArrival {
  let dx = target.x - from.x;
  let dy = target.y - from.y;
  let dz = target.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-4)) {
    dx = 0;
    dy = 0;
    dz = -1;
  } else {
    dx /= len;
    dy /= len;
    dz /= len;
  }
  const look = { yaw: 0, pitch: 0 };
  poseFromForward(dx, dy, dz, look);
  return {
    x: target.x - dx * standoff,
    y: target.y - dy * standoff,
    z: target.z - dz * standoff,
    yaw: look.yaw,
    pitch: look.pitch,
    dx,
    dy,
    dz,
    travel: Math.hypot(
      target.x - dx * standoff - from.x,
      target.y - dy * standoff - from.y,
      target.z - dz * standoff - from.z,
    ),
  };
}

export type JumpStartResult = { ok: true } | { ok: false; reason: JumpFail };

export interface CoordinateJump {
  readonly active: boolean;
  readonly phase: JumpPhase;
  readonly elapsed: number;
  readonly duration: number;
  readonly streakDuration: number;
  readonly streakU: number;
  readonly target: MatrixCoord | null;
  readonly targetWorld: { x: number; y: number; z: number } | null;
  readonly arrival: JumpArrival | null;
  start(coord: MatrixCoord): JumpStartResult;
  cancel(): void;
  step(dt: number): void;
  /** Scrub without integrating velocity (dt = 0). */
  seek(time: number): void;
}

export interface CoordinateJumpOptions {
  flight: FlightController;
  gripped?: () => boolean;
  inCore?: () => boolean;
  trace?: () => number;
  reduceMotion?: () => boolean;
  /** Kick destination sector gen. Called from align through streak. */
  preload?: (x: number, y: number, z: number) => void;
  /** Switch the streamer window to the landing pose. */
  arrive?: (x: number, y: number, z: number) => void;
  onStart?: (coord: MatrixCoord) => void;
  onArrive?: (coord: MatrixCoord) => void;
}

export function createCoordinateJump(opts: CoordinateJumpOptions): CoordinateJump {
  const flight = opts.flight;
  let phase: JumpPhase = 'idle';
  let elapsed = 0;
  let streakDur = JUMP_STREAK_MIN;
  let target: MatrixCoord | null = null;
  let targetWorld: { x: number; y: number; z: number } | null = null;
  let arrival: JumpArrival | null = null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let syaw = 0;
  let spitch = 0;
  let baseFov = 75;
  let arrived = false;

  const reduced = (): boolean => opts.reduceMotion?.() === true;

  const guards = (): JumpFail | null =>
    jumpBlockReason({
      gripped: opts.gripped?.() === true,
      inCore: opts.inCore?.() === true,
      trace: opts.trace?.() ?? 0,
    });

  const kickPreload = (): void => {
    if (!arrival) return;
    opts.preload?.(arrival.x, arrival.y, arrival.z);
  };

  const apply = (t: number, dt: number): void => {
    if (!arrival || !targetWorld || !target) return;
    const total = JUMP_ALIGN + streakDur;
    const motion = reduced();
    if (t < JUMP_ALIGN) {
      phase = 'align';
      const a = smooth01(t / JUMP_ALIGN);
      flight.setPose({
        x: sx,
        y: sy,
        z: sz,
        yaw: syaw + wrapAngle(arrival.yaw - syaw) * a,
        pitch: spitch + (arrival.pitch - spitch) * a,
        bank: 0,
        fov: baseFov,
        vx: 0,
        vy: 0,
        vz: 0,
      });
      kickPreload();
      return;
    }
    if (t < total) {
      phase = 'streak';
      const u = (t - JUMP_ALIGN) / streakDur;
      const e = smooth01(u);
      const x = sx + (arrival.x - sx) * e;
      const y = sy + (arrival.y - sy) * e;
      const z = sz + (arrival.z - sz) * e;
      const rise = (motion ? JUMP_PITCH_RISE_REDUCED : JUMP_PITCH_RISE) * Math.sin(Math.PI * u);
      const kick = (motion ? JUMP_FOV_KICK_REDUCED : JUMP_FOV_KICK) * Math.sin(Math.PI * u);
      const px = flight.pose.x;
      const py = flight.pose.y;
      const pz = flight.pose.z;
      const inv = dt > 1e-8 ? 1 / dt : 0;
      flight.setPose({
        x,
        y,
        z,
        yaw: arrival.yaw,
        pitch: arrival.pitch + rise,
        bank: 0,
        fov: baseFov + kick,
        vx: (x - px) * inv,
        vy: (y - py) * inv,
        vz: (z - pz) * inv,
      });
      kickPreload();
      return;
    }
    phase = 'done';
    flight.setPose({
      x: arrival.x,
      y: arrival.y,
      z: arrival.z,
      yaw: arrival.yaw,
      pitch: arrival.pitch,
      bank: 0,
      fov: baseFov,
      vx: 0,
      vy: 0,
      vz: 0,
    });
    if (!arrived) {
      arrived = true;
      opts.arrive?.(arrival.x, arrival.y, arrival.z);
      opts.onArrive?.(target);
    }
  };

  const jump: CoordinateJump = {
    get active() {
      return phase === 'align' || phase === 'streak';
    },
    get phase() {
      return phase;
    },
    get elapsed() {
      return elapsed;
    },
    get duration() {
      return JUMP_ALIGN + streakDur;
    },
    get streakDuration() {
      return streakDur;
    },
    get streakU() {
      if (phase !== 'streak' || !(streakDur > 0)) return 0;
      return clamp((elapsed - JUMP_ALIGN) / streakDur, 0, 1);
    },
    get target() {
      return target;
    },
    get targetWorld() {
      return targetWorld;
    },
    get arrival() {
      return arrival;
    },
    start(coord) {
      const blocked = guards();
      if (blocked) return { ok: false, reason: blocked };
      if (phase === 'align' || phase === 'streak') return { ok: false, reason: 'busy' };
      const world = matrixCoordToWorld(coord);
      const pose = flight.pose;
      const land = jumpArrival(pose, world);
      target = coord;
      targetWorld = world;
      arrival = land;
      sx = pose.x;
      sy = pose.y;
      sz = pose.z;
      syaw = pose.yaw;
      spitch = pose.pitch;
      baseFov = flight.params.fovBase;
      streakDur = jumpStreakDuration(land.travel);
      elapsed = 0;
      arrived = false;
      phase = 'align';
      kickPreload();
      opts.onStart?.(coord);
      apply(0, 0);
      return { ok: true };
    },
    cancel() {
      phase = 'idle';
      elapsed = 0;
      target = null;
      targetWorld = null;
      arrival = null;
      arrived = false;
      flight.setPose({
        vx: 0,
        vy: 0,
        vz: 0,
        fov: flight.params.fovBase,
      });
    },
    step(dt) {
      if (phase !== 'align' && phase !== 'streak') return;
      if (!(dt > 0)) return;
      elapsed += dt;
      apply(elapsed, dt);
    },
    seek(time) {
      if (!arrival) return;
      elapsed = Math.max(0, time);
      apply(elapsed, 0);
    },
  };
  return jump;
}
