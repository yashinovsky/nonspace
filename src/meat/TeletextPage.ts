import { NTSC_HEIGHT, NTSC_WIDTH } from '../render/post/rasterCrt';
import { TeletextColor, type TeletextColor as Color } from './colors';

export const TELETEXT_COLS = 40;
export const TELETEXT_ROWS = 24;
export const TELETEXT_CELL_W = NTSC_WIDTH / TELETEXT_COLS; // 8
export const TELETEXT_CELL_H = NTSC_HEIGHT / TELETEXT_ROWS; // 10

export const CellFlag = {
  mosaic: 1 << 0,
  separated: 1 << 1,
  doubleHeight: 1 << 2,
  flash: 1 << 3,
} as const;

export interface TeletextAttrs {
  fg: Color;
  bg: Color;
  mosaic: boolean;
  separated: boolean;
  doubleHeight: boolean;
  flash: boolean;
}

export const DEFAULT_ATTRS: TeletextAttrs = {
  fg: TeletextColor.white,
  bg: TeletextColor.black,
  mosaic: false,
  separated: false,
  doubleHeight: false,
  flash: false,
};

/**
 * 40×24 WST-style page. Cells are a flat array, row-major. Control is via
 * the paint helpers (set-after colour is the caller's job: a control cell
 * is a blank with the *previous* colours).
 */
export interface TeletextPage {
  magazine: number;
  pageNumber: number;
  /** Inserted into the header between the page number and the clock. */
  headerTitle: string;
  readonly codes: Uint8Array;
  readonly fg: Uint8Array;
  readonly bg: Uint8Array;
  readonly flags: Uint8Array;
}

export function cellIndex(row: number, col: number): number {
  return row * TELETEXT_COLS + col;
}

export function createPage(opts?: {
  magazine?: number;
  pageNumber?: number;
  headerTitle?: string;
}): TeletextPage {
  const n = TELETEXT_COLS * TELETEXT_ROWS;
  const page: TeletextPage = {
    magazine: opts?.magazine ?? 1,
    pageNumber: opts?.pageNumber ?? 100,
    headerTitle: opts?.headerTitle ?? '',
    codes: new Uint8Array(n),
    fg: new Uint8Array(n),
    bg: new Uint8Array(n),
    flags: new Uint8Array(n),
  };
  page.codes.fill(0x20);
  page.fg.fill(TeletextColor.white);
  page.bg.fill(TeletextColor.black);
  return page;
}

export function clonePage(src: TeletextPage): TeletextPage {
  return {
    magazine: src.magazine,
    pageNumber: src.pageNumber,
    headerTitle: src.headerTitle,
    codes: src.codes.slice(),
    fg: src.fg.slice(),
    bg: src.bg.slice(),
    flags: src.flags.slice(),
  };
}

export function readAttrs(page: TeletextPage, row: number, col: number): TeletextAttrs {
  const i = cellIndex(row, col);
  const f = page.flags[i]!;
  return {
    fg: page.fg[i] as Color,
    bg: page.bg[i] as Color,
    mosaic: (f & CellFlag.mosaic) !== 0,
    separated: (f & CellFlag.separated) !== 0,
    doubleHeight: (f & CellFlag.doubleHeight) !== 0,
    flash: (f & CellFlag.flash) !== 0,
  };
}

export function writeCell(
  page: TeletextPage,
  row: number,
  col: number,
  code: number,
  attrs: Partial<TeletextAttrs> = {},
): void {
  if (row < 0 || row >= TELETEXT_ROWS || col < 0 || col >= TELETEXT_COLS) return;
  const i = cellIndex(row, col);
  const prev = readAttrs(page, row, col);
  const next: TeletextAttrs = { ...prev, ...attrs };
  page.codes[i] = code & 0x7f;
  page.fg[i] = next.fg;
  page.bg[i] = next.bg;
  let flags = 0;
  if (next.mosaic) flags |= CellFlag.mosaic;
  if (next.separated) flags |= CellFlag.separated;
  if (next.doubleHeight) flags |= CellFlag.doubleHeight;
  if (next.flash) flags |= CellFlag.flash;
  page.flags[i] = flags;
}

export function clearRow(
  page: TeletextPage,
  row: number,
  attrs: Partial<TeletextAttrs> = {},
): void {
  for (let c = 0; c < TELETEXT_COLS; c++) writeCell(page, row, c, 0x20, attrs);
}

export function writeText(
  page: TeletextPage,
  row: number,
  col: number,
  text: string,
  attrs: Partial<TeletextAttrs> = {},
): number {
  const t = text.toUpperCase();
  let c = col;
  for (let i = 0; i < t.length && c < TELETEXT_COLS; i++, c++) {
    writeCell(page, row, c, t.charCodeAt(i), { mosaic: false, ...attrs });
  }
  return c;
}

/**
 * WST 2×3 mosaic: bits 0,1,2,3,4,6 of the character code are TL,TR,ML,MR,BL,BR.
 * Bit 5 is the 0x20 offset of the G1 set and is not a pixel.
 */
export function mosaicCode(mask: {
  tl?: boolean;
  tr?: boolean;
  ml?: boolean;
  mr?: boolean;
  bl?: boolean;
  br?: boolean;
}): number {
  return (
    0x20 |
    (mask.tl ? 0x01 : 0) |
    (mask.tr ? 0x02 : 0) |
    (mask.ml ? 0x04 : 0) |
    (mask.mr ? 0x08 : 0) |
    (mask.bl ? 0x10 : 0) |
    (mask.br ? 0x40 : 0)
  );
}

export const MOSAIC_FULL = mosaicCode({
  tl: true,
  tr: true,
  ml: true,
  mr: true,
  bl: true,
  br: true,
});
export const MOSAIC_TOP = mosaicCode({ tl: true, tr: true, ml: true, mr: true });
export const MOSAIC_BOTTOM = mosaicCode({ bl: true, br: true });
export const MOSAIC_LEFT = mosaicCode({ tl: true, ml: true, bl: true });
export const MOSAIC_RIGHT = mosaicCode({ tr: true, mr: true, br: true });

export function mosaicBits(code: number): {
  tl: boolean;
  tr: boolean;
  ml: boolean;
  mr: boolean;
  bl: boolean;
  br: boolean;
} {
  return {
    tl: (code & 0x01) !== 0,
    tr: (code & 0x02) !== 0,
    ml: (code & 0x04) !== 0,
    mr: (code & 0x08) !== 0,
    bl: (code & 0x10) !== 0,
    br: (code & 0x40) !== 0,
  };
}

export function writeMosaic(
  page: TeletextPage,
  row: number,
  col: number,
  code: number,
  attrs: Partial<TeletextAttrs> = {},
): void {
  writeCell(page, row, col, code, { mosaic: true, ...attrs });
}

export function fillMosaic(
  page: TeletextPage,
  row: number,
  col: number,
  width: number,
  height: number,
  code: number,
  attrs: Partial<TeletextAttrs> = {},
): void {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) writeMosaic(page, row + r, col + c, code, attrs);
  }
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `HH:MM:SS` — 8 characters, last cells of the header row. */
export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatPageNumber(magazine: number, pageNumber: number): string {
  const n = ((magazine % 10) * 100 + (pageNumber % 100)).toString().padStart(3, '0');
  return `P${n}`;
}

/**
 * Row 0: `P101  CHIBA   NITE CITY          23:14:30`
 * White on red, yellow clock (Ceefax-style).
 */
export function writeHeader(page: TeletextPage, date: Date): void {
  const ident = formatPageNumber(page.magazine, page.pageNumber);
  const title = page.headerTitle.toUpperCase().slice(0, 24);
  const clock = formatClock(date);
  const mid = ident.padEnd(6, ' ') + title;
  const line = (mid.slice(0, TELETEXT_COLS - 8).padEnd(TELETEXT_COLS - 8, ' ') + clock).slice(
    0,
    TELETEXT_COLS,
  );
  for (let c = 0; c < TELETEXT_COLS; c++) {
    const clockCell = c >= TELETEXT_COLS - 8;
    writeCell(page, 0, c, line.charCodeAt(c), {
      fg: clockCell ? TeletextColor.yellow : TeletextColor.white,
      bg: TeletextColor.red,
      mosaic: false,
      doubleHeight: false,
      flash: false,
      separated: false,
    });
  }
}

/**
 * Mark `row` and `row+1` as a double-height pair and write `text` on `row`.
 * The lower row is blank DH so the renderer shows the bottom half of the glyph.
 */
export function writeDoubleHeight(
  page: TeletextPage,
  row: number,
  col: number,
  text: string,
  attrs: Partial<TeletextAttrs> = {},
): void {
  const t = text.toUpperCase();
  const dh = { ...attrs, doubleHeight: true, mosaic: false };
  for (let i = 0; i < t.length; i++) {
    writeCell(page, row, col + i, t.charCodeAt(i), dh);
    if (row + 1 < TELETEXT_ROWS) writeCell(page, row + 1, col + i, 0x20, dh);
  }
}

export function isDoubleHeightBottom(page: TeletextPage, row: number, col: number): boolean {
  if (row <= 0) return false;
  const here = readAttrs(page, row, col);
  const above = readAttrs(page, row - 1, col);
  return here.doubleHeight && above.doubleHeight;
}
