import { type RGB, rgba } from './palette';

/**
 * Procedural 14-segment VFD glyphs (plan §6.5), stroked as lines.
 * Segments in a unit cell, x → right, y → down:
 *   A top, B upper right, C lower right, D bottom, E lower left, F upper left,
 *   G mid left, g mid right, H/J upper diagonals, I upper centre, K/M lower diagonals, L lower centre.
 */
const SEG: Record<string, [number, number, number, number]> = {
  A: [0, 0, 1, 0],
  B: [1, 0, 1, 0.5],
  C: [1, 0.5, 1, 1],
  D: [0, 1, 1, 1],
  E: [0, 0.5, 0, 1],
  F: [0, 0, 0, 0.5],
  G: [0, 0.5, 0.5, 0.5],
  g: [0.5, 0.5, 1, 0.5],
  H: [0, 0, 0.5, 0.5],
  I: [0.5, 0, 0.5, 0.5],
  J: [1, 0, 0.5, 0.5],
  K: [0, 1, 0.5, 0.5],
  L: [0.5, 0.5, 0.5, 1],
  M: [1, 1, 0.5, 0.5],
};
const ALL = Object.keys(SEG);

const GLYPH: Record<string, string> = {
  '0': 'ABCDEFJK',
  '1': 'BCJ',
  '2': 'ABGgED',
  '3': 'ABCDg',
  '4': 'FGgBC',
  '5': 'AFGgCD',
  '6': 'AFEDCGg',
  '7': 'ABC',
  '8': 'ABCDEFGg',
  '9': 'ABCDFGg',
  A: 'ABCEFGg',
  B: 'ABCDILg',
  C: 'ADEF',
  D: 'ABCDIL',
  E: 'ADEFG',
  F: 'AEFG',
  G: 'ACDEFg',
  H: 'BCEFGg',
  I: 'ADIL',
  J: 'BCDE',
  K: 'EFGJM',
  L: 'DEF',
  M: 'BCEFHJ',
  N: 'BCEFHM',
  O: 'ABCDEF',
  P: 'ABEFGg',
  Q: 'ABCDEFM',
  R: 'ABEFGgM',
  S: 'ADFGgC',
  T: 'AIL',
  U: 'BCDEF',
  V: 'EFKJ',
  W: 'BCEFKM',
  X: 'HJKM',
  Y: 'HJL',
  Z: 'ADJK',
  '-': 'Gg',
  '/': 'JK',
  '_': 'D',
  '+': 'GgIL',
  '%': 'FJKC',
  ':': '',
  '.': '',
  ' ': '',
  '<': 'JM',
  '>': 'HK',
  '[': 'ADEF',
  ']': 'ABCD',
  '=': 'GgD',
  '*': 'GgHJKM',
};

export interface VfdStyle {
  color: RGB;
  size: number;
  /** 0..1 brightness of lit segments */
  intensity?: number;
  /** draw the 6% ghost segments of unlit cells */
  ghost?: boolean;
  align?: 'left' | 'right' | 'center';
}

export const VFD_ASPECT = 0.58;
export const VFD_ADVANCE = 0.86;

export function vfdWidth(text: string, size: number): number {
  return text.length * size * VFD_ADVANCE;
}

/** Draw text as 14-segment VFD glyphs. (x, y) is the top-left (or right/centre per align). */
export function drawVfd(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, st: VfdStyle): void {
  const h = st.size;
  const w = h * VFD_ASPECT;
  const adv = h * VFD_ADVANCE;
  const total = vfdWidth(text, h);
  let x0 = x;
  if (st.align === 'right') x0 = x - total;
  else if (st.align === 'center') x0 = x - total / 2;
  const inset = 0.09;
  const skew = 0.1;
  const lit = new Path2D();
  const ghost = new Path2D();
  const dots: Array<[number, number]> = [];

  const seg = (path: Path2D, cx: number, s: [number, number, number, number]) => {
    const [ax, ay, bx, by] = s;
    const ix = (bx - ax) * inset;
    const iy = (by - ay) * inset;
    const px = (u: number, v: number) => cx + u * w + (1 - v) * w * skew;
    path.moveTo(px(ax + ix, ay + iy), y + (ay + iy) * h);
    path.lineTo(px(bx - ix, by - iy), y + (by - iy) * h);
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toUpperCase();
    const cx = x0 + i * adv;
    const g = GLYPH[ch] ?? '';
    if (ch === '.' || ch === ':') {
      dots.push([cx + w * 0.45, y + h * 0.98]);
      if (ch === ':') dots.push([cx + w * 0.5, y + h * 0.4]);
    }
    for (const k of ALL) {
      if (g.includes(k)) seg(lit, cx, SEG[k]);
      else if (st.ghost) seg(ghost, cx, SEG[k]);
    }
  }

  const I = st.intensity ?? 1;
  const lw = Math.max(1, h * 0.085);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  if (st.ghost) {
    ctx.strokeStyle = rgba(st.color, 0.06);
    ctx.lineWidth = lw;
    ctx.stroke(ghost);
  }
  ctx.strokeStyle = rgba(st.color, 0.22 * I);
  ctx.lineWidth = lw * 3;
  ctx.stroke(lit);
  ctx.strokeStyle = rgba(st.color, 0.95 * I);
  ctx.lineWidth = lw;
  ctx.stroke(lit);
  ctx.fillStyle = rgba(st.color, 0.95 * I);
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, lw * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
