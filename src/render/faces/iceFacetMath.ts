/** CPU twin of iceFacet.frag hatching (plan §8.5). */

export const WHITE_HATCH_DENSITY = 7.5;
export const GRAY_HATCH_DENSITY = 18.5;
export const WHITE_HATCH_WIDTH = 0.09;
export const GRAY_HATCH_WIDTH = 0.045;

export const WHITE_SHELLS = 2;
export const GRAY_SHELLS = 4;
export const BLACK_SHELLS = 3;

/** Telegraph flicker Hz. Must stay ≤ 3 flashes/s (plan §5.9). */
export const TELEGRAPH_FLICKER_HZ = 2;

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function hatchLine(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  density: number,
  width: number,
): number {
  const len = Math.hypot(dx, dy, dz) || 1;
  const s = ((x * dx + y * dy + z * dz) / len) * density;
  const f = Math.abs(s - Math.floor(s) - 0.5);
  return 1 - smoothstep(width, width + 0.045, f);
}

/** Two hatch sets; product is the moiré beat. */
export function hatchCoverage(
  x: number,
  y: number,
  z: number,
  density: number,
  angleA: number,
  angleB: number,
  width: number,
): { lines: number; moire: number; cov: number } {
  const dA = { x: Math.cos(angleA), y: 0.18, z: Math.sin(angleA) };
  const dB = { x: Math.cos(angleB), y: -0.22, z: Math.sin(angleB) };
  const hA = hatchLine(x, y, z, dA.x, dA.y, dA.z, density, width);
  const hB = hatchLine(x, y, z, dB.x, dB.y, dB.z, density * 1.07, width * 0.92);
  const lines = Math.max(hA, hB);
  const moire = hA * hB;
  return { lines, moire, cov: Math.max(lines * 0.72, moire) };
}

export function telegraphFlicker(time: number, amount: number, reduceFlashing = false): number {
  if (amount <= 0) return 0;
  const amp = reduceFlashing ? Math.min(amount, 0.22) : amount;
  if (reduceFlashing) return amp;
  return amp * (0.55 + 0.45 * Math.sin(time * Math.PI * 2 * TELEGRAPH_FLICKER_HZ));
}

export function classLook(iceClass: 'white' | 'gray' | 'black' | 'ta'): {
  shells: number;
  density: number;
  width: number;
  intensity: number;
  counterRotate: boolean;
  spin: number;
} {
  if (iceClass === 'white') {
    return {
      shells: WHITE_SHELLS,
      density: WHITE_HATCH_DENSITY,
      width: WHITE_HATCH_WIDTH,
      intensity: 2.35,
      counterRotate: false,
      spin: 0.18,
    };
  }
  if (iceClass === 'gray') {
    return {
      shells: GRAY_SHELLS,
      density: GRAY_HATCH_DENSITY,
      width: GRAY_HATCH_WIDTH,
      intensity: 1.05,
      counterRotate: true,
      spin: 0.42,
    };
  }
  return {
    shells: BLACK_SHELLS,
    density: 0,
    width: 0,
    intensity: 0.85,
    counterRotate: true,
    spin: 0.14,
  };
}
