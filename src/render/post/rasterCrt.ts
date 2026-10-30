/**
 * Raster CRT / NTSC helpers (plan §8.5 M1.7). Pure — no WebGL — so the
 * transition envelope and the chroma-bleed kernel can be unit-tested.
 */

export const NTSC_WIDTH = 320;
export const NTSC_HEIGHT = 240;

/** Simstim flip duration (plan §5.9). */
export const RASTER_TRANSITION_DURATION = 0.3;

/** Horizontal I/Q blur radius in 320-wide NTSC pixels (plan §8.5 ≈ 4 px). */
export const CHROMA_RADIUS_PX = 4;
/** Horizontal Y blur radius in 320-wide NTSC pixels (plan §8.5 ≈ 1 px). */
export const LUMA_RADIUS_PX = 1;

export interface RasterCrtParams {
  /** Barrel distortion k. Vector CRT uses ≈ 0.015; raster is stronger. */
  barrel: number;
  scanlines: number;
  grille: number;
  vignette: number;
  /** Raised black floor (raster lift; vector CRT keeps true black). */
  blackLift: number;
  chromaPx: number;
  lumaPx: number;
  bloom: number;
  interlace: number;
  /** Base H-hold (0 = locked). Transition adds on top. */
  hHold: number;
  staticAmount: number;
  tracking: number;
}

export const RASTER_CRT_DEFAULTS: RasterCrtParams = {
  barrel: 0.085,
  scanlines: 1,
  grille: 0.6,
  vignette: 0.7,
  blackLift: 0.055,
  chromaPx: CHROMA_RADIUS_PX,
  lumaPx: LUMA_RADIUS_PX,
  bloom: 0.28,
  interlace: 1,
  hHold: 0,
  staticAmount: 0,
  tracking: 0,
};

export interface Yiq {
  y: number;
  i: number;
  q: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** FCC NTSC RGB→YIQ (0..1). */
export function rgbToYiq(r: number, g: number, b: number): Yiq {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    i: 0.596 * r - 0.274 * g - 0.322 * b,
    q: 0.211 * r - 0.523 * g + 0.312 * b,
  };
}

/** FCC NTSC YIQ→RGB (0..1, unclamped). */
export function yiqToRgb(y: number, i: number, q: number): Rgb {
  return {
    r: y + 0.956 * i + 0.621 * q,
    g: y - 0.272 * i - 0.647 * q,
    b: y - 1.106 * i + 1.703 * q,
  };
}

export function gaussianWeights(radius: number, sigma: number): number[] {
  const w: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const g = Math.exp(-(i * i) / (2 * sigma * sigma));
    w.push(g);
    sum += g;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return w;
}

/**
 * Horizontal NTSC blur of a 320-wide RGB row: Y at ~1 px, I/Q at ~4 px.
 * `row` is `[r,g,b] * width` in 0..1.
 */
export function ntscChromaBleed(
  row: Float32Array,
  width = NTSC_WIDTH,
  chromaPx = CHROMA_RADIUS_PX,
  lumaPx = LUMA_RADIUS_PX,
): Float32Array {
  const yW = gaussianWeights(lumaPx, Math.max(0.5, lumaPx * 0.85));
  const iqW = gaussianWeights(chromaPx, Math.max(0.75, chromaPx * 0.5));
  const out = new Float32Array(width * 3);
  for (let x = 0; x < width; x++) {
    let Y = 0;
    let I = 0;
    let Q = 0;
    for (let k = -lumaPx; k <= lumaPx; k++) {
      const s = Math.min(width - 1, Math.max(0, x + k));
      const yiq = rgbToYiq(row[s * 3]!, row[s * 3 + 1]!, row[s * 3 + 2]!);
      Y += yiq.y * yW[k + lumaPx]!;
    }
    for (let k = -chromaPx; k <= chromaPx; k++) {
      const s = Math.min(width - 1, Math.max(0, x + k));
      const yiq = rgbToYiq(row[s * 3]!, row[s * 3 + 1]!, row[s * 3 + 2]!);
      I += yiq.i * iqW[k + chromaPx]!;
      Q += yiq.q * iqW[k + chromaPx]!;
    }
    const rgb = yiqToRgb(Y, I, Q);
    out[x * 3] = rgb.r;
    out[x * 3 + 1] = rgb.g;
    out[x * 3 + 2] = rgb.b;
  }
  return out;
}

export interface RasterTransitionWeights {
  hHold: number;
  staticAmount: number;
  tracking: number;
  /** Peak-to-peak luminance modulation this frame (0 = none). */
  flicker: number;
}

const IDLE_WEIGHTS: RasterTransitionWeights = {
  hHold: 0,
  staticAmount: 0,
  tracking: 0,
  flicker: 0,
};

/**
 * 0.3 s analog channel-change: one H-hold roll, one soft static burst, tracking
 * noise that settles. A single luminance bump (not a strobe) so a 0.3 s play
 * is well under the §5.9 cap of 3 flashes/s. Low contrast by construction.
 *
 * Writes into `out` when given (hot path: no alloc).
 */
export function rasterTransitionAt(
  elapsed: number,
  duration = RASTER_TRANSITION_DURATION,
  out?: RasterTransitionWeights,
): RasterTransitionWeights {
  const dest = out ?? { hHold: 0, staticAmount: 0, tracking: 0, flicker: 0 };
  if (elapsed < 0 || elapsed >= duration || duration <= 0) {
    dest.hHold = 0;
    dest.staticAmount = 0;
    dest.tracking = 0;
    dest.flicker = 0;
    return dest;
  }
  const u = elapsed / duration;
  dest.hHold = (1 - u) * (1 - u);
  const burst = u < 0.4 ? Math.sin((u / 0.4) * Math.PI) : 0;
  dest.staticAmount = burst * 0.2;
  dest.tracking = u < 0.65 ? (1 - u / 0.65) * 0.35 : 0;
  dest.flicker = burst * 0.05;
  return dest;
}

/** Worst-case extra luminance from the transition (static mix + flicker dim). */
export function rasterTransitionLuma(weights: RasterTransitionWeights): number {
  return weights.flicker * 0.5 + weights.staticAmount * 0.18;
}

/**
 * Count threshold crossings of a rising edge. Used to audit the 0.3 s
 * envelope against §5.9 (≤ 3 general flashes/s).
 */
export function countFlashes(samples: readonly number[], threshold: number): number {
  let flashes = 0;
  let above = false;
  for (const s of samples) {
    if (!above && s >= threshold) {
      above = true;
      flashes += 1;
    } else if (above && s < threshold) {
      above = false;
    }
  }
  return flashes;
}

export function sampleTransitionLuma(
  duration = RASTER_TRANSITION_DURATION,
  fps = 60,
  reduceFlashing = false,
): number[] {
  const n = Math.round(fps);
  const dt = 1 / fps;
  const out: number[] = [];
  const w = { ...IDLE_WEIGHTS };
  for (let i = 0; i < n; i++) {
    rasterTransitionAt(i * dt, duration, w);
    if (reduceFlashing) {
      w.flicker = 0;
      w.staticAmount *= 0.25;
    }
    out.push(rasterTransitionLuma(w));
  }
  return out;
}
