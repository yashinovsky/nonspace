import { TeletextColor } from '../../meat/colors';
import type { InkChoice } from '../../narrative/InkRuntime';
import {
  createPage,
  fillMosaic,
  MOSAIC_BOTTOM,
  MOSAIC_FULL,
  MOSAIC_LEFT,
  MOSAIC_RIGHT,
  MOSAIC_TOP,
  mosaicCode,
  writeCell,
  writeDoubleHeight,
  writeHeader,
  writeMosaic,
  writeText,
  type TeletextPage,
} from '../../meat/TeletextPage';

export type TeletextPageId = 'test' | 'phone' | 'text';

export interface PagePaint {
  pageId: TeletextPageId;
  clock: Date;
  lines: readonly string[];
  choices: readonly InkChoice[];
  /** Drive the payphone mosaic flash. */
  phoneSounding?: boolean;
  title?: string;
  pageNumber?: number;
}

const C = TeletextColor;

function stampChoices(page: TeletextPage, choices: readonly InkChoice[], row: number): void {
  for (const ch of choices) {
    if (ch.index < 1 || ch.index > 4) continue;
    const r = row + Math.floor((ch.index - 1) / 2);
    const col = (ch.index - 1) % 2 === 0 ? 1 : 21;
    writeText(page, r, col, `${ch.index} ${ch.text}`.slice(0, 18), { fg: C.white });
  }
}

function stampSkyline(page: TeletextPage, row: number, col: number): void {
  const cyan = { fg: C.cyan, bg: C.black };
  const blue = { fg: C.blue, bg: C.black };
  const yellow = { fg: C.yellow, bg: C.black };
  // Distant towers.
  fillMosaic(page, row, col + 6, 2, 1, MOSAIC_BOTTOM, cyan);
  fillMosaic(page, row, col + 12, 2, 1, MOSAIC_BOTTOM, cyan);
  fillMosaic(page, row + 1, col + 4, 6, 1, MOSAIC_FULL, cyan);
  fillMosaic(page, row + 1, col + 12, 4, 1, MOSAIC_FULL, yellow);
  fillMosaic(page, row + 2, col + 1, 18, 1, MOSAIC_FULL, cyan);
  fillMosaic(page, row + 3, col, 20, 1, MOSAIC_FULL, blue);
  writeText(page, row + 4, col + 6, 'CHIBA', { fg: C.yellow });
}

function stampPhone(page: TeletextPage, row: number, col: number, ringing: boolean): void {
  const body = { fg: C.white, bg: C.black, mosaic: true, flash: false };
  const hand = { fg: C.cyan, bg: C.black, mosaic: true, flash: ringing };
  const mid = mosaicCode({ tl: true, tr: true, ml: true, mr: true, bl: true, br: true });
  const sides = mosaicCode({ tl: true, tr: true, ml: true, mr: true });
  writeMosaic(page, row, col + 1, MOSAIC_BOTTOM, hand);
  writeMosaic(page, row, col + 2, MOSAIC_BOTTOM, hand);
  writeMosaic(page, row + 1, col, MOSAIC_RIGHT, hand);
  writeMosaic(page, row + 1, col + 3, MOSAIC_LEFT, hand);
  writeMosaic(page, row + 1, col + 1, sides, body);
  writeMosaic(page, row + 1, col + 2, sides, body);
  fillMosaic(page, row + 2, col, 4, 2, mid, body);
  writeMosaic(page, row + 4, col + 1, MOSAIC_TOP, body);
  writeMosaic(page, row + 4, col + 2, MOSAIC_TOP, body);
  // Ringing arcs — alphanumeric, flash with the cadence.
  writeText(page, row + 1, col + 5, ')))', { fg: C.yellow, flash: true });
}

function stampColorBars(page: TeletextPage, row: number): void {
  const order = [C.black, C.red, C.green, C.yellow, C.blue, C.magenta, C.cyan, C.white] as const;
  const names = ['K', 'R', 'G', 'Y', 'B', 'M', 'C', 'W'];
  const w = 5;
  for (let i = 0; i < 8; i++) {
    const fg = order[i]!;
    if (fg === C.black) {
      for (let c = 0; c < w; c++) {
        writeCell(page, row, i * w + c, 0x20, { fg: C.black, bg: C.white, mosaic: false });
      }
      writeCell(page, row, i * w + 2, names[i]!.charCodeAt(0), {
        fg: C.black,
        bg: C.white,
        mosaic: false,
      });
    } else {
      fillMosaic(page, row, i * w, w, 1, MOSAIC_FULL, { fg, bg: C.black });
    }
    writeCell(page, row + 1, i * w + 2, names[i]!.charCodeAt(0), {
      fg: fg === C.black ? C.white : fg,
      bg: C.black,
      mosaic: false,
    });
  }
}

function stampMosaicDemo(page: TeletextPage, row: number): void {
  writeText(page, row, 1, 'MOSAIC', { fg: C.green });
  const patterns = [
    mosaicCode({ tl: true, tr: true }),
    mosaicCode({ ml: true, mr: true }),
    mosaicCode({ bl: true, br: true }),
    mosaicCode({ tl: true, ml: true, bl: true }),
    mosaicCode({ tr: true, mr: true, br: true }),
    MOSAIC_FULL,
    mosaicCode({ tl: true, br: true }),
    mosaicCode({ tr: true, bl: true }),
  ];
  for (let i = 0; i < patterns.length; i++) {
    writeMosaic(page, row, 9 + i * 2, patterns[i]!, { fg: C.yellow });
    writeMosaic(page, row, 10 + i * 2, patterns[i]!, { fg: C.cyan, separated: true });
  }
  writeText(page, row, 28, 'SEP', { fg: C.cyan });
  writeDoubleHeight(page, row, 36, 'H', { fg: C.white });
}

/**
 * Authentic 40×24 test card: 8 colours, contiguous + separated mosaics,
 * double-height title, header clock, Chiba skyline, ringing payphone, 1–4.
 */
export function paintTestCard(spec: PagePaint): TeletextPage {
  const page = createPage({
    magazine: 1,
    pageNumber: spec.pageNumber ?? 101,
    headerTitle: spec.title ?? 'CHIBA   NITE CITY',
  });
  writeHeader(page, spec.clock);
  writeText(page, 1, 14, 'NONSPACE', { fg: C.yellow });
  writeText(page, 3, 8, 'TELETEXT TEST CARD', { fg: C.cyan });
  stampColorBars(page, 4);
  stampMosaicDemo(page, 6);
  stampSkyline(page, 8, 1);
  stampPhone(page, 8, 28, spec.phoneSounding ?? true);
  writeText(page, 13, 28, 'RINGING', { fg: C.yellow, flash: true });
  let r = 15;
  for (const line of spec.lines) {
    if (r >= 18) break;
    writeText(page, r, 1, line.slice(0, 38), { fg: C.white });
    r += 1;
  }
  stampChoices(page, spec.choices, 19);
  writeText(page, 22, 1, 'PRESS 1-4', { fg: C.green });
  writeText(page, 23, 1, 'RASTER CRT  320X240  40X24', { fg: C.blue });
  return page;
}

export function paintPhonePage(spec: PagePaint): TeletextPage {
  const page = createPage({
    magazine: 1,
    pageNumber: spec.pageNumber ?? 103,
    headerTitle: spec.title ?? 'WINTERMUTE',
  });
  writeHeader(page, spec.clock);
  writeDoubleHeight(page, 2, 6, 'PAYPHONE', { fg: C.yellow });
  stampPhone(page, 5, 16, spec.phoneSounding ?? true);
  writeDoubleHeight(page, 11, 12, spec.phoneSounding ? 'RINGING' : 'SILENT ', {
    fg: C.yellow,
    flash: true,
  });
  let r = 14;
  for (const line of spec.lines) {
    if (r >= 18) break;
    writeText(page, r, 2, line.slice(0, 36), { fg: C.white });
    r += 1;
  }
  stampChoices(page, spec.choices, 19);
  writeText(page, 22, 1, 'PRESS 1-4', { fg: C.green });
  return page;
}

export function paintTextPage(spec: PagePaint): TeletextPage {
  const page = createPage({
    magazine: 1,
    pageNumber: spec.pageNumber ?? 102,
    headerTitle: spec.title ?? 'CHIBA   NITE CITY',
  });
  writeHeader(page, spec.clock);
  writeDoubleHeight(page, 2, 2, (spec.title ?? 'INTERLUDE').slice(0, 18), { fg: C.yellow });
  let r = 5;
  for (const line of spec.lines) {
    if (r >= 18) break;
    writeText(page, r, 2, line.slice(0, 36), { fg: C.white });
    r += 1;
  }
  stampChoices(page, spec.choices, 19);
  writeText(page, 22, 1, 'PRESS 1-4', { fg: C.green });
  return page;
}

export function paintTeletextPage(spec: PagePaint): TeletextPage {
  if (spec.pageId === 'phone') return paintPhonePage(spec);
  if (spec.pageId === 'text') return paintTextPage(spec);
  return paintTestCard(spec);
}
