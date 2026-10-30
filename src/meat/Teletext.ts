import { CanvasTexture, LinearFilter, LinearSRGBColorSpace, NearestFilter } from 'three';
import { NTSC_HEIGHT, NTSC_WIDTH } from '../render/post/rasterCrt';
import { TELETEXT_RGB } from './colors';
import { FONT_COLS, FONT_PAD_X, FONT_PAD_Y, FONT_ROWS, glyphPixel } from './font';
import {
  isDoubleHeightBottom,
  mosaicBits,
  readAttrs,
  TELETEXT_CELL_H,
  TELETEXT_CELL_W,
  TELETEXT_COLS,
  TELETEXT_ROWS,
  type TeletextPage,
} from './TeletextPage';

/** 1 Hz flash (0.5 s on). Under the §5.7 / §5.9 cap of 3 Hz. Never full-page. */
export const TELETEXT_FLASH_HZ = 1;

export function flashOn(time: number, reduceFlashing: boolean): boolean {
  if (reduceFlashing) return true;
  return Math.floor(time * TELETEXT_FLASH_HZ * 2) % 2 === 0;
}

export interface BlitOpts {
  time?: number;
  reduceFlashing?: boolean;
  /** When set, flashing mosaic "ring" cells follow this instead of the 1 Hz flash. */
  phoneSounding?: boolean;
}

function put(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  rgb: readonly [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= NTSC_WIDTH || y >= NTSC_HEIGHT) return;
  const i = (y * NTSC_WIDTH + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

function fillRect(
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
): void {
  const x1 = Math.min(NTSC_WIDTH, x0 + w);
  const y1 = Math.min(NTSC_HEIGHT, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) put(data, x, y, rgb);
  }
}

const MOSAIC_H = [3, 3, 4] as const; // 3+3+4 = 10
const MOSAIC_W = 4;

function drawMosaic(
  data: Uint8ClampedArray,
  ox: number,
  oy: number,
  code: number,
  fg: readonly [number, number, number],
  bg: readonly [number, number, number],
  separated: boolean,
): void {
  const bits = mosaicBits(code);
  const cells: readonly boolean[] = [bits.tl, bits.tr, bits.ml, bits.mr, bits.bl, bits.br];
  let y = oy;
  for (let row = 0; row < 3; row++) {
    const h = MOSAIC_H[row]!;
    for (let col = 0; col < 2; col++) {
      const on = cells[row * 2 + col]!;
      const x = ox + col * MOSAIC_W;
      if (separated) {
        fillRect(data, x, y, MOSAIC_W, h, bg);
        if (on) fillRect(data, x + 1, y + 1, MOSAIC_W - 2, Math.max(1, h - 2), fg);
      } else if (on) {
        fillRect(data, x, y, MOSAIC_W, h, fg);
      }
    }
    y += h;
  }
}

function drawGlyph(
  data: Uint8ClampedArray,
  ox: number,
  oy: number,
  ch: string,
  fg: readonly [number, number, number],
  half: 'full' | 'top' | 'bottom',
): void {
  if (half === 'full') {
    for (let gy = 0; gy < FONT_ROWS; gy++) {
      for (let gx = 0; gx < FONT_COLS; gx++) {
        if (glyphPixel(ch, gx, gy)) put(data, ox + FONT_PAD_X + gx, oy + FONT_PAD_Y + gy, fg);
      }
    }
    return;
  }
  // Stretch 4 source rows across the 10 px cell.
  const src0 = half === 'top' ? 0 : 4;
  for (let dy = 0; dy < TELETEXT_CELL_H; dy++) {
    const gy = src0 + Math.min(3, Math.floor((dy * 4) / TELETEXT_CELL_H));
    for (let gx = 0; gx < FONT_COLS; gx++) {
      if (glyphPixel(ch, gx, gy)) {
        const x = ox + FONT_PAD_X + gx;
        put(data, x, oy + dy, fg);
        // Thicker strokes so DH titles survive NTSC chroma bleed at 320×240.
        put(data, x + 1, oy + dy, fg);
      }
    }
  }
}

/**
 * Blit a 40×24 page into a 320×240 RGBA buffer (NTSC raster). Pure — no DOM.
 * Reuses `data` (length 320×240×4); does not allocate.
 */
export function blitPage(data: Uint8ClampedArray, page: TeletextPage, opts: BlitOpts = {}): void {
  const time = opts.time ?? 0;
  const reduce = opts.reduceFlashing ?? false;
  const flashed = flashOn(time, reduce);

  for (let row = 0; row < TELETEXT_ROWS; row++) {
    for (let col = 0; col < TELETEXT_COLS; col++) {
      const attrs = readAttrs(page, row, col);
      const i = row * TELETEXT_COLS + col;
      const code = page.codes[i]!;
      const ox = col * TELETEXT_CELL_W;
      const oy = row * TELETEXT_CELL_H;
      const bg = TELETEXT_RGB[attrs.bg]!;
      fillRect(data, ox, oy, TELETEXT_CELL_W, TELETEXT_CELL_H, bg);

      let lit = true;
      if (attrs.flash) {
        lit = opts.phoneSounding !== undefined ? opts.phoneSounding : flashed;
      }
      const fg = lit ? TELETEXT_RGB[attrs.fg]! : bg;

      if (attrs.mosaic) {
        drawMosaic(data, ox, oy, code, fg, bg, attrs.separated);
        continue;
      }

      if (code === 0x20 || !lit) continue;
      const ch = String.fromCharCode(code);
      const dhBottom = isDoubleHeightBottom(page, row, col);
      const half = attrs.doubleHeight ? (dhBottom ? 'bottom' : 'top') : 'full';
      drawGlyph(data, ox, oy, ch, fg, half);
    }
  }
}

export function createImageBuffer(): Uint8ClampedArray {
  return new Uint8ClampedArray(NTSC_WIDTH * NTSC_HEIGHT * 4);
}

export interface Teletext {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  paint(page: TeletextPage, opts?: BlitOpts): void;
  dispose(): void;
}

/**
 * Canvas2D 320×240 teletext → `CanvasTexture` for RasterCrtPass.source.
 */
export function createTeletext(): Teletext {
  const canvas = document.createElement('canvas');
  canvas.width = NTSC_WIDTH;
  canvas.height = NTSC_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const image = ctx.createImageData(NTSC_WIDTH, NTSC_HEIGHT);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;

  return {
    canvas,
    texture,
    paint(page, opts) {
      blitPage(image.data, page, opts);
      ctx.putImageData(image, 0, 0);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}
