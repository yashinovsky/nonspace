/** Rec.709 luminance. Matches the GLSL `tonemap.frag` stub. */
export const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Reinhard on luminance + desaturate-to-white above 1.0 (plan §5.3, §8.5).
 * Intensity 4 beams go toward white; nominal 1.0 keeps hue.
 */
export function tonemapReinhardWhite(rgb: Rgb, exposure = 1): Rgb {
  const r = rgb.r * exposure;
  const g = rgb.g * exposure;
  const b = rgb.b * exposure;
  const lum = LUMA.r * r + LUMA.g * g + LUMA.b * b;
  const denom = 1 + Math.max(lum, 0);
  const mappedR = r / denom;
  const mappedG = g / denom;
  const mappedB = b / denom;
  const t = Math.min(1, Math.max(0, (lum - 1) / 3));
  return {
    r: mappedR + (1 - mappedR) * t,
    g: mappedG + (1 - mappedG) * t,
    b: mappedB + (1 - mappedB) * t,
  };
}

export function chroma(rgb: Rgb): number {
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
}
