/**
 * Vector CRT helpers (plan §8.5 M1.6). Pure — no WebGL — so barrel, flicker
 * and the true-black floor can be unit-tested.
 */

/** Mild Wells-Gardner / Color-XY barrel (plan §8.5). */
export const VECTOR_BARREL_K = 0.015;
/** Sub-pixel beam jitter cap in pixels. */
export const VECTOR_JITTER_PX = 0.25;
/** Peak flicker amplitude (≤ 3%). Scaled by vector load. */
export const VECTOR_FLICKER_AMP = 0.03;
export const VECTOR_VIGNETTE = 0.42;
export const VECTOR_GLASS = 0.4;
export const VECTOR_GRAIN = 0.035;

export interface VectorCrtParams {
  barrel: number;
  jitter: number;
  flicker: number;
  vignette: number;
  glass: number;
  grain: number;
  enableBarrel: boolean;
  enableJitter: boolean;
  enableFlicker: boolean;
  enableVignette: boolean;
  enableGlass: boolean;
  enableGrain: boolean;
}

export const VECTOR_CRT_DEFAULTS: VectorCrtParams = {
  barrel: VECTOR_BARREL_K,
  jitter: VECTOR_JITTER_PX,
  flicker: VECTOR_FLICKER_AMP,
  vignette: VECTOR_VIGNETTE,
  glass: VECTOR_GLASS,
  grain: VECTOR_GRAIN,
  enableBarrel: true,
  enableJitter: true,
  enableFlicker: true,
  enableVignette: true,
  enableGlass: true,
  enableGrain: true,
};

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Flicker amplitude written to the shader. Reduce flashing or a disabled
 * toggle forces 0. Otherwise `amount * load`, capped at 3%.
 */
export function flickerAmplitude(
  load: number,
  reduceFlashing: boolean,
  amount = VECTOR_FLICKER_AMP,
  enabled = true,
): number {
  if (reduceFlashing || !enabled) return 0;
  return Math.min(VECTOR_FLICKER_AMP, Math.max(0, amount)) * clamp01(load);
}

export interface Uv {
  x: number;
  y: number;
}

/** Same barrel as `vectorCrt.frag`. k = 0 is identity. */
export function barrelUv(u: number, v: number, k: number): Uv {
  const cx = u * 2 - 1;
  const cy = v * 2 - 1;
  const r2 = cx * cx + cy * cy;
  const s = 1 + k * r2;
  return { x: cx * s * 0.5 + 0.5, y: cy * s * 0.5 + 0.5 };
}

/** Grain / glass / vignette / flicker are multiplicative, so black stays 0. */
export function modulatePhosphor(
  rgb: { r: number; g: number; b: number },
  mul: number,
): { r: number; g: number; b: number } {
  return { r: rgb.r * mul, g: rgb.g * mul, b: rgb.b * mul };
}
