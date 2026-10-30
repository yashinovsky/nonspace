import type { Vec3 } from '../../core/math/vec3';

/** Shared beach layout (CPU collision / sim). Keep in sync with `beach.frag`. */

export const WATER_Y = 0.08;
export const EYE_HEIGHT = 1.55;
export const WALK_SPEED = 1.85;
export const WALK_BOOST = 2.9;
export const PLAYER_RADIUS = 0.38;
export const PITCH_CLAMP = (80 * Math.PI) / 180;
export const MOUSE_LOOK = 0.0022;
export const STICK_LOOK = 1.6;
export const FOV_DEG = 58;
export const SUN_PERIOD = 48;
export const STILL_TAU = 1.35;
export const EXIT_RADIUS = 3.4;
export const LINDA_RADIUS = 3.2;
export const MAX_MARCH = 64;

export const SPAWN = { x: 2.2, y: 0, z: 1.4, yaw: -0.52, pitch: 0.02 };
export const EXIT = { x: 28, y: 0, z: -5.5 };
export const LINDA = { x: -3.6, y: 0, z: -6.2 };
export const BOY = { x: -2.15, y: 0, z: -5.35 };
export const BUNKER = { x: -14.2, y: 0, z: 16.2 };

/** Inland AABB of the bunker, minus a door gap on the ocean (−Z) face. */
export const BUNKER_AABB = {
  minX: -17.4,
  maxX: -10.9,
  minZ: 13.7,
  maxZ: 18.6,
  doorMinX: -14.95,
  doorMaxX: -13.45,
};

const TMP: Vec3 = { x: 0, y: 0, z: 0 };

/** Base sand height (no fBm). Matches the shader's slope term. */
export function sandHeight(x: number, z: number): number {
  const shore = smoothstep(-11, -1, z);
  const dune = 0.14 * Math.sin(x * 0.17) * Math.sin(z * 0.11) * shore;
  return -0.06 + 0.72 * shore + dune;
}

export function figureY(x: number, z: number): number {
  return Math.max(sandHeight(x, z), WATER_Y);
}

/** Sun elevation: 0 = dawn over the ocean (−Z), π/2 = noon, π = dusk inland. */
export function sunAngle(time: number, period = SUN_PERIOD): number {
  return (time / period) * Math.PI * 2;
}

export function sunDir(angle: number, out: Vec3 = TMP): Vec3 {
  out.x = 0.22;
  out.y = Math.sin(angle);
  out.z = -Math.cos(angle);
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  return out;
}

export function sunElevation(angle: number): number {
  return Math.sin(angle);
}

/**
 * Checkerboard tell (plan §5.8): grows when the player is still and looking down.
 * `lookDown` is −forward.y (1 = straight down).
 */
export function checkerReveal(stillness: number, lookDown: number): number {
  const gaze = clamp((lookDown - 0.28) / 0.55, 0, 1);
  return clamp(stillness * gaze, 0, 1);
}

export function updateStillness(prev: number, speed: number, dt: number): number {
  const target = speed < 0.08 ? 1 : 0;
  const k = 1 - Math.exp(-dt / STILL_TAU);
  return prev + (target - prev) * k;
}

export function lookVectors(
  yaw: number,
  pitch: number,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
): void {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  forward.x = sy * cp;
  forward.y = sp;
  forward.z = -cy * cp;
  right.x = cy;
  right.y = 0;
  right.z = sy;
  up.x = -sy * sp;
  up.y = cp;
  up.z = cy * sp;
}

/** Horizontal unit vector toward the dub-bass exit. */
export function bassDirection(x: number, z: number, out: Vec3): Vec3 {
  const dx = EXIT.x - x;
  const dz = EXIT.z - z;
  const len = Math.hypot(dx, dz) || 1;
  out.x = dx / len;
  out.y = 0;
  out.z = dz / len;
  return out;
}

export function bassDistance(x: number, z: number): number {
  return Math.hypot(EXIT.x - x, EXIT.z - z);
}

export function lindaDistance(x: number, z: number): number {
  return Math.hypot(LINDA.x - x, LINDA.z - z);
}

export function nearExit(x: number, z: number, radius = EXIT_RADIUS): boolean {
  return bassDistance(x, z) <= radius;
}

export function nearLinda(x: number, z: number, radius = LINDA_RADIUS): boolean {
  return lindaDistance(x, z) <= radius;
}

/**
 * Push a disk of `radius` out of the bunker footprint. The ocean-facing
 * doorway is open so the player can stand under the lintel.
 */
export function resolveBunker(x: number, z: number, radius: number): { x: number; z: number } {
  const { minX, maxX, minZ, maxZ, doorMinX, doorMaxX } = BUNKER_AABB;
  const inDoorX = x > doorMinX - radius * 0.2 && x < doorMaxX + radius * 0.2;
  const inDoorZ = z < minZ + 0.9;
  if (inDoorX && inDoorZ) return { x, z };

  const qx = clamp(x, minX, maxX);
  const qz = clamp(z, minZ, maxZ);
  const dx = x - qx;
  const dz = z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 > radius * radius && (x < minX || x > maxX || z < minZ || z > maxZ)) {
    return { x, z };
  }
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    const left = x - minX;
    const right = maxX - x;
    const south = z - minZ;
    const north = maxZ - z;
    const m = Math.min(left, right, south, north);
    if (m === left) return { x: minX - radius, z };
    if (m === right) return { x: maxX + radius, z };
    if (m === south) return { x, z: minZ - radius };
    return { x, z: maxZ + radius };
  }
  const s = (radius + 0.02) / d;
  return { x: qx + dx * s, z: qz + dz * s };
}

export function clampWorld(x: number, z: number): { x: number; z: number } {
  return {
    x: clamp(x, -36, 42),
    z: clamp(z, -18, 26),
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t > Math.PI ? t - Math.PI * 2 : t < -Math.PI ? t + Math.PI * 2 : t;
}
