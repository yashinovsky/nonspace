import type { InputFrame } from '../../input/Input';
import type { Vec3 } from '../../core/math/vec3';
import {
  clamp,
  clampWorld,
  EYE_HEIGHT,
  lerp,
  lookVectors,
  MOUSE_LOOK,
  PITCH_CLAMP,
  PLAYER_RADIUS,
  resolveBunker,
  sandHeight,
  SPAWN,
  STICK_LOOK,
  WATER_Y,
  WALK_BOOST,
  WALK_SPEED,
  wrapAngle,
} from './world';

export interface WalkPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface WalkInput {
  thrust: number;
  strafe: number;
  lookX: number;
  lookY: number;
  mouseDx: number;
  mouseDy: number;
  boost: boolean;
  locked: boolean;
}

export interface WalkController {
  readonly pose: WalkPose;
  readonly prev: WalkPose;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  speed: number;
  frozen: boolean;
  step(input: WalkInput, dt: number): void;
  copyPose(dst: WalkPose): void;
  sample(alpha: number, dst: WalkPose): WalkPose;
  sitAt(x: number, z: number, yaw: number, pitch: number): void;
}

export function emptyWalkInput(): WalkInput {
  return {
    thrust: 0,
    strafe: 0,
    lookX: 0,
    lookY: 0,
    mouseDx: 0,
    mouseDy: 0,
    boost: false,
    locked: true,
  };
}

export function readWalkInput(frame: InputFrame, dst: WalkInput): WalkInput {
  dst.thrust = frame.thrust;
  dst.strafe = frame.strafe;
  dst.lookX = frame.lookX;
  dst.lookY = frame.lookY;
  dst.mouseDx = frame.mouseDx;
  dst.mouseDy = frame.mouseDy;
  dst.boost = frame.down('boost');
  dst.locked = frame.pointerLocked || frame.gamepadConnected;
  return dst;
}

function copy(src: WalkPose, dst: WalkPose): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
}

function groundY(x: number, z: number): number {
  return Math.max(sandHeight(x, z), WATER_Y - 0.12) + EYE_HEIGHT;
}

export function createWalkController(): WalkController {
  const pose: WalkPose = {
    x: SPAWN.x,
    y: groundY(SPAWN.x, SPAWN.z),
    z: SPAWN.z,
    yaw: SPAWN.yaw,
    pitch: SPAWN.pitch,
  };
  const prev: WalkPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch };
  const forward: Vec3 = { x: 0, y: 0, z: -1 };
  const right: Vec3 = { x: 1, y: 0, z: 0 };
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  lookVectors(pose.yaw, pose.pitch, forward, right, up);

  const api: WalkController = {
    pose,
    prev,
    forward,
    right,
    up,
    speed: 0,
    frozen: false,
    step(input, dt) {
      copy(pose, prev);
      if (!api.frozen) {
        pose.yaw = wrapAngle(pose.yaw + input.mouseDx * MOUSE_LOOK + input.lookX * STICK_LOOK * dt);
        pose.pitch = clamp(
          pose.pitch + input.mouseDy * MOUSE_LOOK + input.lookY * STICK_LOOK * dt,
          -PITCH_CLAMP,
          PITCH_CLAMP,
        );
      }
      lookVectors(pose.yaw, pose.pitch, forward, right, up);

      if (api.frozen) {
        api.speed = 0;
        pose.y = groundY(pose.x, pose.z) - 0.42;
        return;
      }

      const max = input.boost ? WALK_BOOST : WALK_SPEED;
      const tx = forward.x * input.thrust + right.x * input.strafe;
      const tz = forward.z * input.thrust + right.z * input.strafe;
      const mag = Math.hypot(tx, tz);
      let vx = 0;
      let vz = 0;
      if (mag > 1e-5) {
        const s = max / mag;
        vx = tx * s;
        vz = tz * s;
      }
      api.speed = Math.hypot(vx, vz);
      let x = pose.x + vx * dt;
      let z = pose.z + vz * dt;
      const pushed = resolveBunker(x, z, PLAYER_RADIUS);
      x = pushed.x;
      z = pushed.z;
      const clamped = clampWorld(x, z);
      pose.x = clamped.x;
      pose.z = clamped.z;
      pose.y = groundY(pose.x, pose.z);
    },
    copyPose(dst) {
      copy(pose, dst);
    },
    sample(alpha, dst) {
      dst.x = lerp(prev.x, pose.x, alpha);
      dst.y = lerp(prev.y, pose.y, alpha);
      dst.z = lerp(prev.z, pose.z, alpha);
      dst.yaw = lerp(prev.yaw, pose.yaw, alpha);
      dst.pitch = lerp(prev.pitch, pose.pitch, alpha);
      return dst;
    },
    sitAt(x, z, yaw, pitch) {
      copy(pose, prev);
      pose.x = x;
      pose.z = z;
      pose.y = groundY(x, z) - 0.42;
      pose.yaw = yaw;
      pose.pitch = pitch;
      api.frozen = true;
      api.speed = 0;
      lookVectors(pose.yaw, pose.pitch, forward, right, up);
    },
  };
  return api;
}
