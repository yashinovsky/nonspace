/** CPU twins of black ICE shaders (plan §5.3, §5.5, §8.5, M1.8). */

/** Black ICE edge: ultraviolet `#8A2BFF` (plan §5.3). */
export const UV_EDGE_HEX = 0x8a2bff;

export const UV_EDGE_RGB = {
  r: ((UV_EDGE_HEX >> 16) & 255) / 255,
  g: ((UV_EDGE_HEX >> 8) & 255) / 255,
  b: (UV_EDGE_HEX & 255) / 255,
} as const;

/** `k` in `col *= 1.0 - mask * k`. 1 = the solid is truly black. */
export const DEFAULT_MASK_STRENGTH = 1;

/** Composite silhouette UV glow. */
export const DEFAULT_EDGE_INTENSITY = 1.6;

/** World-space crawl amplitude on UV edge lines (slow lightning). */
export const DEFAULT_CRAWL_AMP = 0.055;

export const DEFAULT_CRAWL_SPEED = 0.85;

export const TENDRIL_H_COUNT = 5;
export const TENDRIL_V_COUNT = 4;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** GLSL `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * After bloom: `(hdr + bloom) * (1 - mask * k)`. The mask eats the construct
 * *and* its glow so black ICE is the one subtractive thing in an additive world.
 */
export function applyMask(
  col: Rgb,
  bloom: Rgb | null,
  mask: number,
  k = DEFAULT_MASK_STRENGTH,
): Rgb {
  const m = 1 - clamp01(mask) * k;
  return {
    r: (col.r + (bloom?.r ?? 0)) * m,
    g: (col.g + (bloom?.g ?? 0)) * m,
    b: (col.b + (bloom?.b ?? 0)) * m,
  };
}

/**
 * Screen-edge grip tendrils (plan §5.5). Veins grow inward from the four
 * edges as `grip` goes 0→1. Matches `tendrilCoverage` in blackIceComposite.frag.
 */
export function tendrilCoverage(u: number, v: number, time: number, grip: number): number {
  if (grip < 1e-4) return 0;
  const g = clamp01(grip);
  const reach = 0.02 + 0.36 * g;
  const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
  const wx = u + 0.045 * Math.sin(v * 22 + time * 0.7) + 0.02 * Math.sin(v * 51 - time * 1.1);
  const wy = v + 0.045 * Math.sin(u * 19 - time * 0.55) + 0.02 * Math.sin(u * 47 + time * 0.9);
  let veins = 0;
  for (let i = 0; i < TENDRIL_H_COUNT; i++) {
    const y0 = (i + 0.5) / TENDRIL_H_COUNT + 0.08 * Math.sin(i * 3.7 + time * 0.4);
    const profile = 1 - smoothstep(0, 0.018, Math.abs(wy - y0));
    const fromL = 1 - smoothstep(0, reach, u);
    const fromR = 1 - smoothstep(0, reach, 1 - u);
    veins = Math.max(veins, profile * Math.max(fromL, fromR));
  }
  for (let i = 0; i < TENDRIL_V_COUNT; i++) {
    const x0 = (i + 0.5) / TENDRIL_V_COUNT + 0.08 * Math.sin(i * 2.9 - time * 0.35);
    const profile = 1 - smoothstep(0, 0.016, Math.abs(wx - x0));
    const fromB = 1 - smoothstep(0, reach, v);
    const fromT = 1 - smoothstep(0, reach, 1 - v);
    veins = Math.max(veins, profile * Math.max(fromB, fromT));
  }
  const matte = 1 - smoothstep(0, reach, edge);
  veins *= 0.35 + 0.65 * matte;
  return clamp01(veins * g);
}

/** World-space crawl on a UV edge endpoint. Matches `crawlOffset` in uvEdge.vert. */
export function crawlOffset(x: number, y: number, z: number, time: number, amp: number): Vec3 {
  if (amp < 1e-6) return { x: 0, y: 0, z: 0 };
  const nx = Math.sin(y * 5.17 + time * 1.73 + z * 0.31);
  const ny = Math.cos(z * 4.91 - time * 1.31 + x * 0.27);
  const nz = Math.sin(x * 6.13 + time * 0.87 - y * 0.19);
  const m =
    Math.sin((x * 0.37 + y * 0.71 + z * 0.13) * 4.0 + time * 1.7) *
    Math.cos((x * 0.21 + y * 0.09 + z * 0.83) * 6.0 - time * 0.9);
  return { x: nx * m * amp, y: ny * m * amp, z: nz * m * amp };
}
