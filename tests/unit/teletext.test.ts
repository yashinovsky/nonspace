import { describe, expect, it } from 'vitest';
import { TeletextColor, TELETEXT_COLOR_NAMES, TELETEXT_RGB } from '../../src/meat/colors';
import { glyphPixel, hasGlyph } from '../../src/meat/font';
import { blitPage, createImageBuffer, flashOn, TELETEXT_FLASH_HZ } from '../../src/meat/Teletext';
import {
  createPage,
  formatClock,
  formatPageNumber,
  isDoubleHeightBottom,
  mosaicBits,
  mosaicCode,
  MOSAIC_FULL,
  TELETEXT_COLS,
  TELETEXT_ROWS,
  writeCell,
  writeDoubleHeight,
  writeHeader,
  writeMosaic,
  writeText,
} from '../../src/meat/TeletextPage';
import { paintTestCard } from '../../src/content/teletext/testCard';
import { NTSC_HEIGHT, NTSC_WIDTH } from '../../src/render/post/rasterCrt';

function rgbAt(data: Uint8ClampedArray, x: number, y: number): [number, number, number] {
  const i = (y * NTSC_WIDTH + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

function countNear(
  data: Uint8ClampedArray,
  target: readonly [number, number, number],
  slop = 2,
): number {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]! - target[0]) <= slop &&
      Math.abs(data[i + 1]! - target[1]) <= slop &&
      Math.abs(data[i + 2]! - target[2]) <= slop
    ) {
      n += 1;
    }
  }
  return n;
}

describe('teletext page', () => {
  it('is 40×24 and maps onto 320×240 NTSC', () => {
    expect(TELETEXT_COLS).toBe(40);
    expect(TELETEXT_ROWS).toBe(24);
    expect(NTSC_WIDTH).toBe(320);
    expect(NTSC_HEIGHT).toBe(240);
    expect(NTSC_WIDTH / TELETEXT_COLS).toBe(8);
    expect(NTSC_HEIGHT / TELETEXT_ROWS).toBe(10);
  });

  it('exposes the WST 8-colour palette', () => {
    expect(TELETEXT_COLOR_NAMES).toHaveLength(8);
    expect(TELETEXT_RGB).toHaveLength(8);
    expect(TELETEXT_RGB[TeletextColor.red]).toEqual([255, 0, 0]);
    expect(TELETEXT_RGB[TeletextColor.cyan]).toEqual([0, 255, 255]);
  });

  it('packs 2×3 mosaic bits as WST G1 (0,1,2,3,4,6)', () => {
    expect(mosaicBits(MOSAIC_FULL)).toEqual({
      tl: true,
      tr: true,
      ml: true,
      mr: true,
      bl: true,
      br: true,
    });
    const tl = mosaicCode({ tl: true });
    expect(tl & 0x01).toBe(0x01);
    expect(tl & 0x40).toBe(0);
    const br = mosaicCode({ br: true });
    expect(br & 0x40).toBe(0x40);
    expect(br & 0x20).toBe(0x20);
  });

  it('writes a header clock into the last 8 cells', () => {
    const page = createPage({ magazine: 1, pageNumber: 101, headerTitle: 'CHIBA   NITE CITY' });
    const local = new Date(2026, 9, 30, 23, 14, 5);
    writeHeader(page, local);
    expect(formatPageNumber(1, 101)).toBe('P101');
    expect(formatClock(local)).toBe('23:14:05');
    let header = '';
    for (let c = 0; c < 40; c++) header += String.fromCharCode(page.codes[c]!);
    expect(header.startsWith('P101')).toBe(true);
    expect(header.endsWith('23:14:05')).toBe(true);
    expect(header).toContain('CHIBA');
  });

  it('marks the row below a double-height title as the bottom half', () => {
    const page = createPage();
    writeDoubleHeight(page, 1, 0, 'AB', { fg: TeletextColor.yellow });
    expect(isDoubleHeightBottom(page, 2, 0)).toBe(true);
    expect(isDoubleHeightBottom(page, 1, 0)).toBe(false);
  });
});

describe('5×7 glyphs', () => {
  it('covers digits and uppercase used on the test card', () => {
    for (const ch of 'NONSPACE 0123456789 TELETEXT') {
      if (ch === ' ') continue;
      expect(hasGlyph(ch)).toBe(true);
      let lit = 0;
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 5; x++) if (glyphPixel(ch, x, y)) lit += 1;
      }
      expect(lit).toBeGreaterThan(4);
    }
  });
});

describe('blitPage', () => {
  it('paints every WST colour on the authentic test card', () => {
    const page = paintTestCard({
      pageId: 'test',
      clock: new Date(2026, 9, 30, 12, 0, 0),
      lines: ['NITE CITY. THE PORT SKY — A DEAD CHANNEL.'],
      choices: [
        { index: 1, text: 'THE STREET', divert: 'street' },
        { index: 2, text: 'A PAYPHONE', divert: 'phone' },
        { index: 3, text: 'THE CLINIC', divert: 'clinic' },
        { index: 4, text: 'JACK IN', divert: 'jack' },
      ],
      phoneSounding: true,
    });
    const data = createImageBuffer();
    blitPage(data, page, { time: 0, phoneSounding: true });

    expect(countNear(data, TELETEXT_RGB[TeletextColor.red]!)).toBeGreaterThan(80);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.green]!)).toBeGreaterThan(40);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.yellow]!)).toBeGreaterThan(80);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.blue]!)).toBeGreaterThan(80);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.magenta]!)).toBeGreaterThan(40);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.cyan]!)).toBeGreaterThan(80);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.white]!)).toBeGreaterThan(80);
    expect(countNear(data, TELETEXT_RGB[TeletextColor.black]!)).toBeGreaterThan(80);

    // Red colour bar is columns 5–9 of row 4.
    const [r, g, b] = rgbAt(data, 5 * 8 + 2, 4 * 10 + 2);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(40);
  });

  it('stretches double-height glyphs across two rows', () => {
    const normal = createPage();
    writeText(normal, 1, 0, 'A', { fg: TeletextColor.white });
    const dh = createPage();
    writeDoubleHeight(dh, 1, 0, 'A', { fg: TeletextColor.white });
    const a = createImageBuffer();
    const b = createImageBuffer();
    blitPage(a, normal, { time: 0 });
    blitPage(b, dh, { time: 0 });
    const lit = (data: Uint8ClampedArray): number => {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! > 200) n += 1;
      return n;
    };
    expect(lit(b)).toBeGreaterThan(lit(a) * 1.4);
  });

  it('fills a mosaic cell from WST bits', () => {
    const page = createPage();
    writeMosaic(page, 0, 0, MOSAIC_FULL, { fg: TeletextColor.yellow });
    const data = createImageBuffer();
    blitPage(data, page, { time: 0 });
    let yellow = 0;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 8; x++) {
        const [r, g, b] = rgbAt(data, x, y);
        if (r > 200 && g > 200 && b < 40) yellow += 1;
      }
    }
    expect(yellow).toBeGreaterThan(60);

    const tl = createPage();
    writeMosaic(tl, 0, 0, mosaicCode({ tl: true }), { fg: TeletextColor.white });
    const tld = createImageBuffer();
    blitPage(tld, tl, { time: 0 });
    const [tlr] = rgbAt(tld, 1, 1);
    const [brr] = rgbAt(tld, 6, 8);
    expect(tlr).toBeGreaterThan(200);
    expect(brr).toBeLessThan(40);
  });

  it('flashes below 3 Hz and holds when Reduce Flashing is on', () => {
    expect(TELETEXT_FLASH_HZ).toBeLessThan(3);
    expect(flashOn(0, false)).toBe(true);
    expect(flashOn(0.6, false)).toBe(false);
    expect(flashOn(0.6, true)).toBe(true);

    const page = createPage();
    writeText(page, 1, 0, 'X', { fg: TeletextColor.white, flash: true });
    const on = createImageBuffer();
    const off = createImageBuffer();
    blitPage(on, page, { time: 0, reduceFlashing: false });
    blitPage(off, page, { time: 0.6, reduceFlashing: false });
    const [onR] = rgbAt(on, 1, 11);
    const [offR] = rgbAt(off, 1, 11);
    expect(onR).toBeGreaterThan(200);
    expect(offR).toBeLessThan(40);
  });

  it('does not allocate per blit (reuses the buffer)', () => {
    const page = createPage();
    writeCell(page, 0, 0, 65, { fg: TeletextColor.green });
    const data = createImageBuffer();
    blitPage(data, page, { time: 0 });
    blitPage(data, page, { time: 1 });
    expect(data.length).toBe(NTSC_WIDTH * NTSC_HEIGHT * 4);
  });
});
