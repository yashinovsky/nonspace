/**
 * Matrix flight model (plan §3.3). Pure sim: no DOM, no Three, no clock.
 * The caller feeds an `InputFrame` and a fixed `dt` (the loop's `SIM_DT`).
 *
 * Look is yaw/pitch (pitch clamped, no roll input). Thrust/strafe are
 * look-relative; rise/fall is world-up. Grid assist, a soft altitude ceiling
 * and hull springs live here so later modes can step one object.
 */

import type { InputFrame } from '../input/Input';
import {
  createCollisionWorld,
  createHit,
  queryHull,
  type CollisionHit,
  type CollisionWorld,
} from './Collision';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export interface FlightParams {
  cruiseMaxSpeed: number;
  boostMaxSpeed: number;
  cruiseAccel: number;
  boostAccel: number;
  /** Exponential half-life (s) of velocity when there is no thrust. */
  dragHalfLife: number;
  pitchClampDeg: number;
  bankMaxDeg: number;
  /** Half-life (s) of visual roll returning to 0, and of bank chasing yaw-rate. */
  autoLevelHalfLife: number;
  fovBase: number;
  fovKick: number;
  /** Radians per pointer-lock pixel (sensitivity is already in `mouseDx`). */
  mouseLook: number;
  /** Full-stick yaw/pitch rate, rad/s. */
  stickLookRate: number;
  /** Yaw rate (rad/s) that produces `bankMaxDeg` of visual roll. */
  bankYawRate: number;
  gridAssist: boolean;
  gridAssistConeDeg: number;
  gridAssistRateDeg: number;
  banking: boolean;
  fovKickEnabled: boolean;
  hullSpringRadius: number;
  /** Spring accel per unit of (radius − gap), u/s² / u. */
  hullSpring: number;
  /** Max push-out speed from inside a hull, u/s. */
  hullPushMax: number;
  altitudeCeiling: number;
  /** Extra downward accel per unit above the ceiling. */
  ceilingSpring: number;
  /** Altitude overshoot (u) that halves look/thrust authority. */
  ceilingSluggish: number;
}

/** Plan §3.3 starting values. Tweakpane binds a mutable copy (`params`). */
export const FLIGHT_DEFAULTS: Readonly<FlightParams> = {
  cruiseMaxSpeed: 80,
  boostMaxSpeed: 600,
  cruiseAccel: 120,
  boostAccel: 900,
  dragHalfLife: 0.6,
  pitchClampDeg: 85,
  bankMaxDeg: 6,
  autoLevelHalfLife: 0.3,
  fovBase: 75,
  fovKick: 12,
  mouseLook: 0.002,
  stickLookRate: 2,
  bankYawRate: 1.5,
  gridAssist: true,
  gridAssistConeDeg: 15,
  gridAssistRateDeg: 30,
  banking: true,
  fovKickEnabled: true,
  hullSpringRadius: 20,
  hullSpring: 40,
  hullPushMax: 240,
  altitudeCeiling: 12_000,
  ceilingSpring: 0.04,
  ceilingSluggish: 2500,
};

export function defaultFlightParams(): FlightParams {
  return { ...FLIGHT_DEFAULTS };
}

export interface FlightPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
  fov: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface FlightTelemetry {
  speed: number;
  altitude: number;
  headingDeg: number;
  pitchDeg: number;
  bankDeg: number;
  fov: number;
  gridAssistActive: boolean;
  ceilingActive: boolean;
  hullContact: boolean;
  iceContact: boolean;
  flare: number;
  controlScale: number;
}

export interface FlightStepOptions {
  /** Settings §8.10: forces banking and FOV kick off. */
  reduceMotion?: boolean;
}

export interface FlightController {
  readonly params: FlightParams;
  /** End of the last `step`. */
  readonly pose: FlightPose;
  /** Pose at the start of the last `step` (for render interpolation). */
  readonly prev: FlightPose;
  readonly telemetry: FlightTelemetry;
  readonly collision: CollisionWorld;
  readonly lastHit: CollisionHit;
  step(frame: InputFrame, dt: number, opts?: FlightStepOptions): void;
  setPose(partial: Partial<FlightPose>): void;
  resetPose(): void;
  resetParams(): void;
  /** Unit look vector from current yaw/pitch. Writes `out`. */
  forward(out: { x: number; y: number; z: number }): { x: number; y: number; z: number };
}

const AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function wrapAngle(x: number): number {
  const tau = Math.PI * 2;
  let y = x % tau;
  if (y <= -Math.PI) y += tau;
  else if (y > Math.PI) y -= tau;
  return y;
}

export function expDecay(halfLife: number, dt: number): number {
  if (halfLife <= 1e-8) return 0;
  return Math.pow(2, -dt / halfLife);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function copyPose(dst: FlightPose, src: FlightPose): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.bank = src.bank;
  dst.fov = src.fov;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
}

function originPose(fov: number): FlightPose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, fov, vx: 0, vy: 0, vz: 0 };
}

function lookTo(yaw: number, pitch: number, out: { x: number; y: number; z: number }): void {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
}

export function poseFromForward(
  x: number,
  y: number,
  z: number,
  out: { yaw: number; pitch: number },
): void {
  const len = Math.hypot(x, y, z) || 1;
  const ny = clamp(y / len, -1, 1);
  out.pitch = Math.asin(ny);
  out.yaw = Math.atan2(x / len, -z / len);
}

export interface FlightControllerOptions {
  collision?: CollisionWorld;
  params?: Partial<FlightParams>;
  pose?: Partial<FlightPose>;
}

export function createFlightController(opts: FlightControllerOptions = {}): FlightController {
  const params = { ...FLIGHT_DEFAULTS, ...opts.params };
  const pose = originPose(params.fovBase);
  const prev = originPose(params.fovBase);
  if (opts.pose) Object.assign(pose, opts.pose);
  copyPose(prev, pose);

  const collision = opts.collision ?? createCollisionWorld();
  const lastHit = createHit();
  const tmpHit = createHit();
  const fwd = { x: 0, y: 0, z: -1 };
  const extracted = { yaw: 0, pitch: 0 };
  const telemetry: FlightTelemetry = {
    speed: 0,
    altitude: 0,
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    fov: params.fovBase,
    gridAssistActive: false,
    ceilingActive: false,
    hullContact: false,
    iceContact: false,
    flare: 0,
    controlScale: 1,
  };

  const writeTelemetry = (gridAssistActive: boolean, controlScale: number): void => {
    const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
    telemetry.speed = speed;
    telemetry.altitude = pose.y;
    telemetry.headingDeg = wrapAngle(pose.yaw) * RAD;
    telemetry.pitchDeg = pose.pitch * RAD;
    telemetry.bankDeg = pose.bank * RAD;
    telemetry.fov = pose.fov;
    telemetry.gridAssistActive = gridAssistActive;
    telemetry.ceilingActive = pose.y > params.altitudeCeiling;
    telemetry.hullContact = lastHit.hit && lastHit.gap <= params.hullSpringRadius;
    telemetry.iceContact = lastHit.ice && lastHit.gap <= params.hullSpringRadius;
    telemetry.flare = lastHit.flare;
    telemetry.controlScale = controlScale;
  };

  const applyGridAssist = (dt: number, scale: number): boolean => {
    if (!params.gridAssist) return false;
    lookTo(pose.yaw, pose.pitch, fwd);
    let bestDot = -2;
    let bx = 0;
    let by = 0;
    let bz = -1;
    for (let i = 0; i < AXES.length; i++) {
      const a = AXES[i]!;
      const d = fwd.x * a[0] + fwd.y * a[1] + fwd.z * a[2];
      if (d > bestDot) {
        bestDot = d;
        bx = a[0];
        by = a[1];
        bz = a[2];
      }
    }
    const dot = clamp(bestDot, -1, 1);
    const angle = Math.acos(dot);
    const cone = params.gridAssistConeDeg * DEG;
    if (angle > cone || angle < 1e-6) return angle <= cone && angle < 1e-6;
    const maxStep = params.gridAssistRateDeg * DEG * dt * scale;
    const t = Math.min(1, maxStep / angle);
    const so = Math.sin(angle);
    const w0 = Math.sin((1 - t) * angle) / so;
    const w1 = Math.sin(t * angle) / so;
    const nx = fwd.x * w0 + bx * w1;
    const ny = fwd.y * w0 + by * w1;
    const nz = fwd.z * w0 + bz * w1;
    poseFromForward(nx, ny, nz, extracted);
    pose.yaw = extracted.yaw;
    pose.pitch = extracted.pitch;
    return true;
  };

  const resolveHulls = (dt: number): void => {
    const hulls = collision.hulls;
    const zone = params.hullSpringRadius;
    lastHit.hit = false;
    lastHit.inside = false;
    lastHit.ice = false;
    lastHit.hullId = '';
    lastHit.kind = '';
    lastHit.nx = 0;
    lastHit.ny = 1;
    lastHit.nz = 0;
    lastHit.gap = Infinity;
    lastHit.flare = 0;
    if (hulls.length === 0 || zone < 0) return;

    let closestGap = Infinity;
    for (let i = 0; i < hulls.length; i++) {
      const hull = hulls[i]!;
      queryHull(pose.x, pose.y, pose.z, hull, tmpHit);
      const gap = tmpHit.gap;
      const nx = tmpHit.nx;
      const ny = tmpHit.ny;
      const nz = tmpHit.nz;
      if (gap < closestGap) {
        closestGap = gap;
        lastHit.hit = true;
        lastHit.inside = gap < 0;
        lastHit.ice = tmpHit.ice;
        lastHit.hullId = tmpHit.hullId;
        lastHit.kind = tmpHit.kind;
        lastHit.nx = nx;
        lastHit.ny = ny;
        lastHit.nz = nz;
        lastHit.gap = gap;
      }
      if (gap >= zone) continue;
      const vn = pose.vx * nx + pose.vy * ny + pose.vz * nz;
      if (gap < 0) {
        if (vn < 0) {
          pose.vx -= nx * vn;
          pose.vy -= ny * vn;
          pose.vz -= nz * vn;
        }
        const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
        const frameMotion = speed * dt + 0.01;
        const push = Math.min(-gap, Math.max(frameMotion, params.hullPushMax * dt));
        pose.x += nx * push;
        pose.y += ny * push;
        pose.z += nz * push;
      } else {
        // Critically damped spring on the 20 u shell: pushes out, settles at the
        // zone radius instead of launching the player through it.
        const error = zone - gap;
        const k = params.hullSpring;
        const c = 2 * Math.sqrt(Math.max(k, 0));
        const acc = (k * error - c * vn) * dt;
        pose.vx += nx * acc;
        pose.vy += ny * acc;
        pose.vz += nz * acc;
      }
    }
    collision.sample(pose.x, pose.y, pose.z, lastHit);
    if (lastHit.hit && lastHit.gap < zone) lastHit.flare = (zone - lastHit.gap) / zone;
    else lastHit.flare = 0;
  };

  writeTelemetry(false, 1);

  const controller: FlightController = {
    params,
    pose,
    prev,
    telemetry,
    collision,
    lastHit,
    forward(out) {
      lookTo(pose.yaw, pose.pitch, out);
      return out;
    },
    setPose(partial) {
      Object.assign(pose, partial);
      const clampPitch = params.pitchClampDeg * DEG;
      pose.pitch = clamp(pose.pitch, -clampPitch, clampPitch);
      copyPose(prev, pose);
      writeTelemetry(false, pose.y > params.altitudeCeiling ? ceilingScale(pose.y, params) : 1);
    },
    resetPose() {
      copyPose(pose, originPose(params.fovBase));
      copyPose(prev, pose);
      writeTelemetry(false, 1);
    },
    resetParams() {
      Object.assign(params, FLIGHT_DEFAULTS);
    },
    step(frame, dt, stepOpts) {
      if (!(dt > 0)) return;
      copyPose(prev, pose);
      const reduceMotion = stepOpts?.reduceMotion === true;
      const over = pose.y - params.altitudeCeiling;
      const controlScale = over > 0 ? 1 / (1 + over / params.ceilingSluggish) : 1;
      const clampPitch = params.pitchClampDeg * DEG;

      const lookScale = controlScale;
      const yaw0 = pose.yaw;
      pose.yaw +=
        (frame.mouseDx * params.mouseLook + frame.lookX * params.stickLookRate * dt) * lookScale;
      pose.pitch +=
        (frame.mouseDy * params.mouseLook + frame.lookY * params.stickLookRate * dt) * lookScale;
      pose.pitch = clamp(pose.pitch, -clampPitch, clampPitch);
      const yawRate = wrapAngle(pose.yaw - yaw0) / dt;

      const assist = applyGridAssist(dt, controlScale);
      pose.pitch = clamp(pose.pitch, -clampPitch, clampPitch);
      pose.yaw = wrapAngle(pose.yaw);

      lookTo(pose.yaw, pose.pitch, fwd);
      const rx = Math.cos(pose.yaw);
      const rz = Math.sin(pose.yaw);

      const boosting = frame.down('boost');
      const accel = boosting ? params.boostAccel : params.cruiseAccel;
      const maxSpeed = boosting ? params.boostMaxSpeed : params.cruiseMaxSpeed;

      let ax = fwd.x * frame.thrust + rx * frame.strafe;
      let ay = fwd.y * frame.thrust + frame.vertical;
      let az = fwd.z * frame.thrust + rz * frame.strafe;
      const aLen = Math.hypot(ax, ay, az);
      const thrusting = aLen > 1e-6;
      if (aLen > 1) {
        const inv = 1 / aLen;
        ax *= inv;
        ay *= inv;
        az *= inv;
      }

      const prevSpeed = Math.hypot(pose.vx, pose.vy, pose.vz);
      if (thrusting) {
        const a = accel * controlScale * dt;
        pose.vx += ax * a;
        pose.vy += ay * a;
        pose.vz += az * a;
      }

      const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
      if (speed > maxSpeed) {
        if (prevSpeed > maxSpeed + 1e-9) {
          // Already over (boost just released): decay the excess with the drag half-life.
          const next = maxSpeed + (speed - maxSpeed) * expDecay(params.dragHalfLife, dt);
          const s = next / speed;
          pose.vx *= s;
          pose.vy *= s;
          pose.vz *= s;
        } else {
          const s = maxSpeed / speed;
          pose.vx *= s;
          pose.vy *= s;
          pose.vz *= s;
        }
      } else if (!thrusting) {
        const d = expDecay(params.dragHalfLife, dt);
        pose.vx *= d;
        pose.vy *= d;
        pose.vz *= d;
      }

      if (over > 0) {
        pose.vy -= params.ceilingSpring * over * dt;
        if (pose.vy > 0) pose.vy *= expDecay(0.4, dt);
      }

      pose.x += pose.vx * dt;
      pose.y += pose.vy * dt;
      pose.z += pose.vz * dt;

      resolveHulls(dt);

      const wantBank =
        !reduceMotion && params.banking
          ? clamp(
              (-yawRate / params.bankYawRate) * (params.bankMaxDeg * DEG),
              -params.bankMaxDeg * DEG,
              params.bankMaxDeg * DEG,
            )
          : 0;
      const bankBlend = 1 - expDecay(params.autoLevelHalfLife, dt);
      pose.bank += (wantBank - pose.bank) * bankBlend;

      const spd = Math.hypot(pose.vx, pose.vy, pose.vz);
      const kick =
        !reduceMotion && params.fovKickEnabled
          ? params.fovKick * clamp(spd / params.boostMaxSpeed, 0, 1)
          : 0;
      const wantFov = params.fovBase + kick;
      pose.fov += (wantFov - pose.fov) * (1 - expDecay(0.15, dt));

      writeTelemetry(assist, controlScale);
    },
  };

  return controller;
}

function ceilingScale(y: number, params: FlightParams): number {
  const over = y - params.altitudeCeiling;
  return over > 0 ? 1 / (1 + over / params.ceilingSluggish) : 1;
}
