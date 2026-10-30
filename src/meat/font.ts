/**
 * 5×7 videotex stand-in for the 8×10 cell (1 px pad). Packed ASCII 32..96,
 * 7 row-bytes each, stored as `row + 0x40`. M3.1 swaps in Px437 IBM CGA.
 */

const ROWS = 7;
const COLS = 5;
const FIRST = 32;
const LAST = 96;
const PACKED =
  '@@@@@@@DDDDD@DJJ@@@@@JJ_J_JJDOTNE^DYYBDHSSHTTHURMDDH@@@@BDHHHDBHDBBBDHDUNDNUD@DD_DD@@@@@DDH@@@_@@@@@@@@DDABBDHHPNQSUYQNDLDDDDNNQABDH_NQAFAQNBFJR_BB_P^AAQNNPP^QQN_ABDHHHNQQNQQNNQQOAAN@DD@DD@@DD@DDHBDHPHDB@@_@_@@HDBABDHNQABD@DNQWUWPNNQQ_QQQ^QQ^QQ^NQPPPQN^QQQQQ^_PP^PP__PP^PPPNQPWQQNQQQ_QQQNDDDDDNGBBBBRLQRTXTRQPPPPPP_Q[UUQQQQYUSQQQNQQQQQN^QQ^PPPNQQQURM^QQ^TRQNQPNAQN_DDDDDDQQQQQQNQQQQQJDQQQUUUJQQJDJQQQQJDDDD_ABDHP_NHHHHHNPHHDBBANBBBBBNDJQ@@@@@@@@@@_HD@@@@@';

const FALLBACK = '?'.charCodeAt(0) - FIRST;

function glyphIndex(ch: string): number {
  const key = ch.length === 1 ? ch.toUpperCase() : '?';
  const code = key.charCodeAt(0);
  if (code < FIRST || code > LAST) return FALLBACK;
  return code - FIRST;
}

export const FONT_COLS = COLS;
export const FONT_ROWS = ROWS;
export const FONT_PAD_X = 1;
export const FONT_PAD_Y = 1;

export function glyphRows(ch: string): readonly number[] {
  const o = glyphIndex(ch) * ROWS;
  const rows: number[] = [];
  for (let r = 0; r < ROWS; r++) rows.push(PACKED.charCodeAt(o + r) - 0x40);
  return rows;
}

/** True if pixel (gx, gy) in 0..4 × 0..6 is lit. */
export function glyphPixel(ch: string, gx: number, gy: number): boolean {
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return false;
  const row = PACKED.charCodeAt(glyphIndex(ch) * ROWS + gy) - 0x40;
  return (row & (1 << (COLS - 1 - gx))) !== 0;
}

export function hasGlyph(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.toUpperCase().charCodeAt(0);
  return code >= FIRST && code <= LAST;
}
