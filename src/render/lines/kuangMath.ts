/**
 * CPU twin of `kuang.frag` thin-film colour (plan §8.5). The only
 * continuous-spectrum material; mimic 0 = oil-film, 1 = T-A emerald.
 */

import { BEAM_HEX, hexToRgb, type Rgb } from '../palette';

/** Tessier-Ashpool emerald, linear-ish sRGB 0..1 (plan §5.3 `TA`). */
export const TA_RGB: Rgb = hexToRgb(0x14c77a);

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Oil-on-water RGB, `x` in 0..1. Magenta → cyan → gold; not a palette lookup.
 * Must stay in lockstep with `spectrum()` in `kuang.frag`.
 */
export function spectrumRgb(x: number): Rgb {
  const t = clamp01(x);
  const mag = { r: 1, g: 0.04, b: 0.88 };
  const cyn = { r: 0.04, g: 0.95, b: 1 };
  const gld = { r: 1, g: 0.72, b: 0.06 };
  const u = smoothstep(0.0, 0.42, t);
  const v = smoothstep(0.38, 1, t);
  const a = {
    r: mag.r + (cyn.r - mag.r) * u,
    g: mag.g + (cyn.g - mag.g) * u,
    b: mag.b + (cyn.b - mag.b) * u,
  };
  return {
    r: a.r + (gld.r - a.r) * v,
    g: a.g + (gld.g - a.g) * v,
    b: a.b + (gld.b - a.b) * v,
  };
}

/** Optical-path phase of a thin film, 0..1. Matches `kuang.frag`. */
export function thinFilm(ndotv: number, thickness: number, time: number): number {
  return fract(2 * 1.33 * thickness * Math.max(ndotv, 0.08) + time * 0.18);
}

/** Mimicry mix: spectrum → T-A emerald. */
export function kuangRgb(ndotv: number, thickness: number, time: number, mimic: number): Rgb {
  const spec = spectrumRgb(thinFilm(ndotv, thickness, time));
  const m = clamp01(mimic);
  return {
    r: spec.r + (TA_RGB.r - spec.r) * m,
    g: spec.g + (TA_RGB.g - spec.g) * m,
    b: spec.b + (TA_RGB.b - spec.b) * m,
  };
}

/** Euclidean RGB distance in 0..1. */
export function rgbDist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

const PALETTE_RGB: readonly Rgb[] = BEAM_HEX.map(hexToRgb);

/**
 * True when `rgb` is farther than `minDist` from every §5.3 beam hue
 * (nominal intensity). Used to prove Kuang's spectrum is unique on screen.
 */
export function isOffPalette(rgb: Rgb, minDist = 0.22): boolean {
  for (const p of PALETTE_RGB) {
    if (rgbDist(rgb, p) < minDist) return false;
  }
  return true;
}
