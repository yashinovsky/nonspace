import { TeletextColor as C } from '../../meat/colors';
import type { InkChoice } from '../../narrative/InkRuntime';
import {
  createPage,
  fillMosaic,
  MOSAIC_BOTTOM,
  MOSAIC_FULL,
  MOSAIC_LEFT,
  MOSAIC_RIGHT,
  MOSAIC_TOP,
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
  phoneSounding?: boolean;
  title?: string;
  pageNumber?: number;
}

const W = { fg: C.white };
const Y = { fg: C.yellow };
const Cy = { fg: C.cyan };
const G = { fg: C.green };

function openPage(spec: PagePaint, n: number, title: string): TeletextPage {
  const page = createPage({
    magazine: 1,
    pageNumber: spec.pageNumber ?? n,
    headerTitle: spec.title ?? title,
  });
  writeHeader(page, spec.clock);
  return page;
}

function stampLines(
  page: TeletextPage,
  spec: PagePaint,
  row: number,
  col: number,
  width: number,
): void {
  let r = row;
  for (const line of spec.lines) {
    if (r >= 18) break;
    writeText(page, r, col, line.slice(0, width), W);
    r += 1;
  }
  for (const ch of spec.choices) {
    if (ch.index < 1 || ch.index > 4) continue;
    writeText(
      page,
      19 + ((ch.index - 1) >> 1),
      ch.index % 2 === 1 ? 1 : 21,
      `${ch.index} ${ch.text}`.slice(0, 18),
      W,
    );
  }
  writeText(page, 22, 1, 'PRESS 1-4', G);
}

function stampPhone(page: TeletextPage, row: number, col: number, ringing: boolean): void {
  const body = { fg: C.white, mosaic: true };
  const hand = { fg: C.cyan, mosaic: true, flash: ringing };
  writeMosaic(page, row, col + 1, MOSAIC_BOTTOM, hand);
  writeMosaic(page, row, col + 2, MOSAIC_BOTTOM, hand);
  writeMosaic(page, row + 1, col, MOSAIC_RIGHT, hand);
  writeMosaic(page, row + 1, col + 3, MOSAIC_LEFT, hand);
  writeMosaic(page, row + 1, col + 1, MOSAIC_TOP, body);
  writeMosaic(page, row + 1, col + 2, MOSAIC_TOP, body);
  fillMosaic(page, row + 2, col, 4, 2, MOSAIC_FULL, body);
  writeMosaic(page, row + 4, col + 1, MOSAIC_TOP, body);
  writeMosaic(page, row + 4, col + 2, MOSAIC_TOP, body);
  writeText(page, row + 1, col + 5, ')))', { fg: C.yellow, flash: true });
}

export function paintTestCard(spec: PagePaint): TeletextPage {
  const page = openPage(spec, 101, 'CHIBA   NITE CITY');
  writeText(page, 1, 14, 'NONSPACE', Y);
  writeText(page, 3, 8, 'TELETEXT TEST CARD', Cy);
  const names = 'KRGYBMCW';
  for (let i = 0; i < 8; i++) {
    const fg = i as typeof C.black;
    const x = i * 5;
    if (i === 0) {
      for (let c = 0; c < 5; c++) writeCell(page, 4, x + c, 0x20, { fg: C.black, bg: C.white });
      writeCell(page, 4, x + 2, names.charCodeAt(0), { fg: C.black, bg: C.white });
    } else {
      fillMosaic(page, 4, x, 5, 1, MOSAIC_FULL, { fg });
    }
    writeCell(page, 5, x + 2, names.charCodeAt(i), { fg: i === 0 ? C.white : fg });
  }
  writeText(page, 6, 1, 'MOSAIC', G);
  // WST 2×3 bit patterns: top, mid, bot, left, right, full, diag, anti.
  const bits = [0x23, 0x2c, 0x70, 0x35, 0x6a, MOSAIC_FULL, 0x61, 0x32];
  for (let i = 0; i < 8; i++) {
    writeMosaic(page, 6, 9 + i * 2, bits[i]!, Y);
    writeMosaic(page, 6, 10 + i * 2, bits[i]!, { fg: C.cyan, separated: true });
  }
  writeText(page, 6, 28, 'SEP', Cy);
  writeDoubleHeight(page, 6, 36, 'H', W);
  fillMosaic(page, 8, 7, 2, 1, MOSAIC_BOTTOM, Cy);
  fillMosaic(page, 8, 13, 2, 1, MOSAIC_BOTTOM, Cy);
  fillMosaic(page, 9, 5, 6, 1, MOSAIC_FULL, Cy);
  fillMosaic(page, 9, 13, 4, 1, MOSAIC_FULL, Y);
  fillMosaic(page, 10, 2, 18, 1, MOSAIC_FULL, Cy);
  fillMosaic(page, 11, 1, 20, 1, MOSAIC_FULL, { fg: C.blue });
  writeText(page, 12, 7, 'CHIBA', Y);
  stampPhone(page, 8, 28, spec.phoneSounding ?? true);
  writeText(page, 13, 28, 'RINGING', { fg: C.yellow, flash: true });
  stampLines(page, spec, 15, 1, 38);
  writeText(page, 23, 1, 'RASTER CRT  320X240  40X24', { fg: C.blue });
  return page;
}

export function paintPhonePage(spec: PagePaint): TeletextPage {
  const page = openPage(spec, 103, 'WINTERMUTE');
  writeDoubleHeight(page, 2, 6, 'PAYPHONE', Y);
  stampPhone(page, 5, 16, spec.phoneSounding ?? true);
  writeDoubleHeight(page, 11, 12, spec.phoneSounding ? 'RINGING' : 'SILENT ', {
    fg: C.yellow,
    flash: true,
  });
  stampLines(page, spec, 14, 2, 36);
  return page;
}

export function paintTextPage(spec: PagePaint): TeletextPage {
  const page = openPage(spec, 102, 'CHIBA   NITE CITY');
  writeDoubleHeight(page, 2, 2, (spec.title ?? 'INTERLUDE').slice(0, 18), Y);
  stampLines(page, spec, 5, 2, 36);
  return page;
}

export function paintTeletextPage(spec: PagePaint): TeletextPage {
  if (spec.pageId === 'phone') return paintPhonePage(spec);
  if (spec.pageId === 'text') return paintTextPage(spec);
  return paintTestCard(spec);
}
