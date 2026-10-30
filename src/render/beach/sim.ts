import {
  bassDirection,
  bassDistance,
  checkerReveal,
  lindaDistance,
  LINDA,
  nearExit,
  nearLinda,
  sunAngle,
  sunDir,
  sunElevation,
  SUN_PERIOD,
  updateStillness,
} from './world';
import {
  createWalkController,
  emptyWalkInput,
  type WalkController,
  type WalkInput,
  type WalkPose,
} from './walk';
import type { Vec3 } from '../../core/math/vec3';

export type BeachPhase = 'walk' | 'sitting' | 'endingB' | 'left';
export type BeachChoice = 'stay' | 'leave';

export interface BeachPulse {
  choice?: BeachChoice;
}

export interface BeachDebug {
  time: number;
  sunAngle: number;
  sunY: number;
  reveal: number;
  stillness: number;
  speed: number;
  phase: BeachPhase;
  bassDistance: number;
  lindaDistance: number;
  x: number;
  z: number;
  pitch: number;
  subtitle: string;
}

export interface BeachSim {
  readonly walk: WalkController;
  readonly debug: BeachDebug;
  readonly input: WalkInput;
  readonly bassDir: Vec3;
  readonly sun: Vec3;
  phase: BeachPhase;
  time: number;
  sunAngle: number;
  reveal: number;
  stillness: number;
  subtitle: string;
  sunPeriod: number;
  /** Engage / sit pressed this tick. */
  sitPressed: boolean;
  step(dt: number): BeachPulse;
  sample(alpha: number, dst: WalkPose): WalkPose;
  forceStay(): BeachPulse;
  forceLeave(): BeachPulse;
  setPose(x: number, z: number, yaw?: number, pitch?: number): void;
  /** Yaw toward the dub-bass exit so thrust walks the leak. */
  faceBass(): void;
}

const SIT_OFFSET = { x: -1.15, z: 1.35 };

export function createBeachSim(): BeachSim {
  const walk = createWalkController();
  const input = emptyWalkInput();
  const bassDir: Vec3 = { x: 1, y: 0, z: 0 };
  const sun: Vec3 = { x: 0.22, y: 0, z: -1 };
  const debug: BeachDebug = {
    time: 0,
    sunAngle: 0,
    sunY: 0,
    reveal: 0,
    stillness: 0,
    speed: 0,
    phase: 'walk',
    bassDistance: 0,
    lindaDistance: 0,
    x: walk.pose.x,
    z: walk.pose.z,
    pitch: walk.pose.pitch,
    subtitle: '',
  };

  let sitSun0 = 0;
  let prevSunY = 0;
  let spoken = false;

  const syncDebug = (): void => {
    debug.time = api.time;
    debug.sunAngle = api.sunAngle;
    debug.sunY = sun.y;
    debug.reveal = api.reveal;
    debug.stillness = api.stillness;
    debug.speed = walk.speed;
    debug.phase = api.phase;
    debug.bassDistance = bassDistance(walk.pose.x, walk.pose.z);
    debug.lindaDistance = lindaDistance(walk.pose.x, walk.pose.z);
    debug.x = walk.pose.x;
    debug.z = walk.pose.z;
    debug.pitch = walk.pose.pitch;
    debug.subtitle = api.subtitle;
  };

  const leave = (): BeachPulse => {
    api.phase = 'left';
    walk.frozen = true;
    api.subtitle = 'The bass pulled you out.';
    syncDebug();
    return { choice: 'leave' };
  };

  const stay = (): BeachPulse => {
    const sx = LINDA.x + SIT_OFFSET.x;
    const sz = LINDA.z + SIT_OFFSET.z;
    walk.sitAt(sx, sz, 0.18, -0.08);
    api.phase = 'sitting';
    sitSun0 = api.sunAngle;
    prevSunY = sunElevation(api.sunAngle);
    api.subtitle = "You don't have to go.";
    spoken = true;
    syncDebug();
    return { choice: 'stay' };
  };

  const api: BeachSim = {
    walk,
    debug,
    input,
    bassDir,
    sun,
    phase: 'walk',
    time: 0,
    sunAngle: 0.35,
    reveal: 0,
    stillness: 0,
    subtitle: '',
    sunPeriod: SUN_PERIOD,
    sitPressed: false,
    step(dt) {
      const pulse: BeachPulse = {};
      api.time += dt;
      if (api.phase === 'endingB') {
        api.sunAngle = Math.PI * 0.97 + Math.sin(api.time * 0.35) * 0.08;
      } else {
        api.sunAngle = sunAngle(api.time, api.sunPeriod) + 0.35;
      }
      sunDir(api.sunAngle, sun);
      walk.step(input, dt);
      bassDirection(walk.pose.x, walk.pose.z, bassDir);
      api.stillness = updateStillness(api.stillness, walk.speed, dt);
      const lookDown = -walk.forward.y;
      const edge = Math.max(0, 1 - bassDistance(walk.pose.x, walk.pose.z) / 16);
      api.reveal = Math.min(1, checkerReveal(api.stillness, lookDown) + edge * 0.28);

      if (api.phase === 'walk') {
        const byLinda = nearLinda(walk.pose.x, walk.pose.z);
        const atEdge = nearExit(walk.pose.x, walk.pose.z);
        if (atEdge) {
          Object.assign(pulse, leave());
        } else if (byLinda && api.sitPressed) {
          Object.assign(pulse, stay());
        } else if (byLinda) {
          api.subtitle = spoken
            ? 'Stay for one more sunset.'
            : 'Linda. Sit with her, or follow the bass.';
          spoken = true;
        } else if (bassDistance(walk.pose.x, walk.pose.z) < 14) {
          api.subtitle = 'A dub bassline, leaking in.';
        } else if (!input.locked) {
          api.subtitle = 'Click to look.';
        } else {
          api.subtitle = '';
        }
      } else if (api.phase === 'sitting') {
        const y = sunElevation(api.sunAngle);
        const crossed = prevSunY > 0.04 && y <= 0.04 && api.sunAngle > sitSun0 + 0.2;
        const waited = api.sunAngle > sitSun0 + Math.PI;
        prevSunY = y;
        api.subtitle = 'The sun slides.';
        if (crossed || waited) {
          api.phase = 'endingB';
          api.subtitle = 'You stayed.';
        }
      } else if (api.phase === 'endingB') {
        api.subtitle = 'You stayed.';
      }

      api.sitPressed = false;
      syncDebug();
      return pulse;
    },
    sample(alpha, dst) {
      return walk.sample(alpha, dst);
    },
    forceStay() {
      if (api.phase === 'endingB' || api.phase === 'left') return {};
      const p = stay();
      api.phase = 'endingB';
      api.subtitle = 'You stayed.';
      syncDebug();
      return p;
    },
    forceLeave() {
      if (api.phase === 'endingB' || api.phase === 'left') return {};
      return leave();
    },
    setPose(x, z, yaw = walk.pose.yaw, pitch = walk.pose.pitch) {
      walk.pose.x = x;
      walk.pose.z = z;
      walk.pose.yaw = yaw;
      walk.pose.pitch = pitch;
      walk.prev.x = x;
      walk.prev.z = z;
      walk.prev.yaw = yaw;
      walk.prev.pitch = pitch;
    },
    faceBass() {
      bassDirection(walk.pose.x, walk.pose.z, bassDir);
      const yaw = Math.atan2(bassDir.x, -bassDir.z);
      walk.pose.yaw = yaw;
      walk.prev.yaw = yaw;
    },
  };

  return api;
}
