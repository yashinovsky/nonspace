/**
 * 16-color simstim palette and 4×4 Bayer dither (plan §5.8 / §8.5).
 * Pure CPU so unit tests can pin the quantizer the shader uses.
 */

export const SIMSTIM_PALETTE_HEX = [
  0x000000, 0x2a2830, 0x4a4854, 0x7a7680, 0xb0aaa2, 0xe4dcd0, 0x6a4c38, 0xb88858, 0xe8b888,
  0x3a4c5c, 0x5a7a8c, 0xa0b8c0, 0xc03028, 0xe8a010, 0x4a6a48, 0xf4ece0,
] as const;

export const PALETTE_SIZE = 16;

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** 4×4 Bayer threshold in 0..1. */
export function bayer4(x: number, y: number): number {
  const ix = ((x % 4) + 4) % 4;
  const iy = ((y % 4) + 4) % 4;
  return (BAYER4[iy]![ix]! + 0.5) / 16;
}

export function hexToRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Packed `vec3[16]` for a shader uniform (48 floats). */
export function paletteUniform(out = new Float32Array(PALETTE_SIZE * 3)): Float32Array {
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = hexToRgb01(SIMSTIM_PALETTE_HEX[i]!);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

export function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [pr, pg, pb] = hexToRgb01(SIMSTIM_PALETTE_HEX[i]!);
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Ordered dither then snap to the 16-color set. `amount` is the Bayer swing
 * in linear RGB (0.04 is a mild I, Robot grain).
 */
export function ditherQuantize(
  r: number,
  g: number,
  b: number,
  x: number,
  y: number,
  amount = 0.04,
): [number, number, number] {
  const t = (bayer4(x, y) - 0.5) * amount;
  const i = nearestPaletteIndex(r + t, g + t, b + t);
  return hexToRgb01(SIMSTIM_PALETTE_HEX[i]!);
}
