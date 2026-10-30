import { CanvasTexture, LinearFilter, LinearSRGBColorSpace, NearestFilter } from 'three';
import { NTSC_HEIGHT, NTSC_WIDTH } from '../render/post/rasterCrt';

/**
 * 75% SMPTE EG 1 color bars at NTSC 320×240. Values are 0..255.
 * Layout: 7 bars (top ~2/3), short cast strip, then -I / white / +Q / pluge.
 */
export const SMPTE_BARS: readonly (readonly [number, number, number])[] = [
  [191, 191, 191], // gray 75%
  [191, 191, 0], // yellow
  [0, 191, 191], // cyan
  [0, 191, 0], // green
  [191, 0, 191], // magenta
  [191, 0, 0], // red
  [0, 0, 191], // blue
];

const MINUS_I: readonly [number, number, number] = [0, 33, 76];
const PLUS_Q: readonly [number, number, number] = [72, 0, 133];
const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];
const PLUGE = [
  [7, 7, 7],
  [19, 19, 19],
  [29, 29, 29],
] as const;

export function smpteRgb(
  x: number,
  y: number,
  width = NTSC_WIDTH,
  height = NTSC_HEIGHT,
): readonly [number, number, number] {
  const fx = Math.min(width - 1, Math.max(0, x)) / width;
  const fy = Math.min(height - 1, Math.max(0, y)) / height;
  if (fy < 0.67) {
    const i = Math.min(6, Math.floor(fx * 7));
    return SMPTE_BARS[i]!;
  }
  if (fy < 0.75) {
    const i = Math.min(6, Math.floor(fx * 7));
    return i % 2 === 0 ? SMPTE_BARS[6]! : SMPTE_BARS[0]!;
  }
  if (fx < 0.3) {
    if (fx < 0.1) return MINUS_I;
    if (fx < 0.2) return WHITE;
    return PLUS_Q;
  }
  if (fx < 0.55) return BLACK;
  const p = Math.min(2, Math.floor(((fx - 0.55) / 0.45) * 3));
  return PLUGE[p]!;
}

export function fillSmpteRgba(
  data: Uint8ClampedArray,
  width = NTSC_WIDTH,
  height = NTSC_HEIGHT,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = smpteRgb(x, y, width, height);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

export function createSmpteCanvas(width = NTSC_WIDTH, height = NTSC_HEIGHT): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const img = ctx.createImageData(width, height);
  fillSmpteRgba(img.data, width, height);
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(Math.floor(width * 0.28), Math.floor(height * 0.42), Math.floor(width * 0.44), 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NONSPACE', width * 0.5, height * 0.46);
  ctx.font = '11px monospace';
  ctx.fillText('NTSC 320x240', width * 0.5, height * 0.535);
  return canvas;
}

export function createSmpteTexture(): CanvasTexture {
  const tex = new CanvasTexture(createSmpteCanvas());
  tex.colorSpace = LinearSRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
