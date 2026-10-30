import { Vector3, type Matrix4 } from 'three';
import type { Vec3 } from '../../core/math/vec3';
import {
  Beam,
  BeamFlag,
  createLineSet,
  DEFAULT_BEAM_INTENSITY,
  DEFAULT_BEAM_WIDTH,
  type LineSet,
} from '../lines/BeamBatch';

/** Inclusive printable ASCII (plan M3.1 AC). */
export const ASCII_START = 32;
export const ASCII_END = 126;

export interface HersheyGlyph {
  /** Advance width in font units. */
  readonly w: number;
  /** Strokes as flat `[x,y,...]`, origin at left/baseline, Y up. */
  readonly s: readonly (readonly number[])[];
}

export interface HersheyFontJson {
  name: string;
  cap: number;
  desc: number;
  first?: number;
  last?: number;
  glyphs: Record<string, HersheyGlyph>;
}

export interface HersheyFont {
  readonly name: string;
  /** Capital height in font units (H stem). */
  readonly cap: number;
  /** Most negative Y (descenders). */
  readonly desc: number;
  readonly glyphs: Readonly<Record<string, HersheyGlyph>>;
}

export type HersheyAlign = 'left' | 'center' | 'right';

export interface HersheyLayoutOpts {
  /** World (or camera-space) capital height. */
  capHeight: number;
  color: Beam;
  intensity?: number;
  /** Beam width in px. */
  width?: number;
  flags?: number;
  align?: HersheyAlign;
  /** Extra advance in font units, scaled by capHeight/cap. */
  tracking?: number;
  x?: number;
  y?: number;
  z?: number;
}

const _right = new Vector3();
const _look = new Vector3();
const _up = new Vector3(0, 1, 0);

export function isAsciiPrintable(ch: string | number): boolean {
  const code = typeof ch === 'number' ? ch : ch.charCodeAt(0);
  return code >= ASCII_START && code <= ASCII_END;
}

export function parseHersheyFont(json: HersheyFontJson): HersheyFont {
  if (!(json.cap > 0) || !json.glyphs) {
    throw new Error('invalid Hershey font JSON');
  }
  return {
    name: json.name,
    cap: json.cap,
    desc: json.desc,
    glyphs: json.glyphs,
  };
}

function i8(n: number): number {
  return n > 127 ? n - 256 : n;
}

/** Decode the compact stroke dump from `scripts/convert-fonts.mjs`. */
export function parseHersheyPacked(bytes: Uint8Array, name: string): HersheyFont {
  if (bytes.length < 2) throw new Error('invalid Hershey font');
  let o = 0;
  const cap = bytes[o++]!;
  const desc = i8(bytes[o++]!);
  const glyphs: Record<string, HersheyGlyph> = {};
  for (let c = ASCII_START; c <= ASCII_END; c++) {
    const w = bytes[o++]!;
    const nStrokes = bytes[o++]!;
    const s: number[][] = [];
    for (let i = 0; i < nStrokes; i++) {
      const npts = bytes[o++]!;
      const stroke: number[] = [];
      for (let p = 0; p < npts; p++) {
        stroke.push(i8(bytes[o++]!), i8(bytes[o++]!));
      }
      s.push(stroke);
    }
    glyphs[String.fromCharCode(c)] = { w, s };
  }
  if (!(cap > 0)) throw new Error('invalid Hershey font');
  return { name, cap, desc, glyphs };
}

export async function loadHersheyFont(url: string, name = 'simplex'): Promise<HersheyFont> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hershey font ${url}: HTTP ${res.status}`);
  const body = res.body;
  if (!body) throw new Error(`Hershey font ${url}: empty body`);
  const plain = url.endsWith('.gz') ? body.pipeThrough(new DecompressionStream('gzip')) : body;
  const buf = new Uint8Array(await new Response(plain).arrayBuffer());
  return parseHersheyPacked(buf, name);
}

function glyphOf(font: HersheyFont, ch: string): HersheyGlyph | undefined {
  return font.glyphs[ch] ?? font.glyphs['?'];
}

export function measureHershey(
  font: HersheyFont,
  text: string,
  capHeight: number,
  tracking = 0,
): { width: number; height: number; capHeight: number } {
  const scale = capHeight / font.cap;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphOf(font, text[i]!);
    w += (g?.w ?? font.cap * 0.6) + tracking;
  }
  return {
    width: w * scale,
    height: (font.cap - font.desc) * scale,
    capHeight,
  };
}

export function countHersheySegments(font: HersheyFont, text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphOf(font, text[i]!);
    if (!g) continue;
    for (const stroke of g.s) {
      const pts = (stroke.length / 2) | 0;
      if (pts >= 2) n += pts - 1;
    }
  }
  return n;
}

function originX(
  font: HersheyFont,
  text: string,
  capHeight: number,
  tracking: number,
  align: HersheyAlign,
  x: number,
): number {
  if (align === 'left') return x;
  const w = measureHershey(font, text, capHeight, tracking).width;
  return align === 'center' ? x - w * 0.5 : x - w;
}

/**
 * Write `text` into an existing LineSet. Returns the segment count used.
 * Does not allocate. Truncates if `set` is shorter than the string.
 */
export function writeHershey(
  set: LineSet,
  font: HersheyFont,
  text: string,
  opts: HersheyLayoutOpts,
): number {
  const scale = opts.capHeight / font.cap;
  const tracking = opts.tracking ?? 0;
  const align = opts.align ?? 'left';
  const ox = originX(font, text, opts.capHeight, tracking, align, opts.x ?? 0);
  const oy = opts.y ?? 0;
  const oz = opts.z ?? 0;
  const color = opts.color;
  const intensity = opts.intensity ?? DEFAULT_BEAM_INTENSITY;
  const width = opts.width ?? DEFAULT_BEAM_WIDTH;
  const flags = opts.flags ?? 0;
  const cap = set.color.length;
  let n = 0;
  let cursor = 0;
  for (let ci = 0; ci < text.length; ci++) {
    const g = glyphOf(font, text[ci]!);
    const adv = (g?.w ?? font.cap * 0.6) + tracking;
    if (g) {
      const dx = ox + cursor * scale;
      for (const stroke of g.s) {
        const pts = (stroke.length / 2) | 0;
        for (let p = 0; p < pts - 1; p++) {
          if (n >= cap) return n;
          const i0 = p * 2;
          const i1 = i0 + 2;
          const o = n * 6;
          set.positions[o] = dx + stroke[i0]! * scale;
          set.positions[o + 1] = oy + stroke[i0 + 1]! * scale;
          set.positions[o + 2] = oz;
          set.positions[o + 3] = dx + stroke[i1]! * scale;
          set.positions[o + 4] = oy + stroke[i1 + 1]! * scale;
          set.positions[o + 5] = oz;
          set.color[n] = color;
          set.intensity[n] = intensity;
          if (set.width) set.width[n] = width;
          if (set.flags) set.flags[n] = flags;
          n++;
        }
      }
    }
    cursor += adv;
  }
  return n;
}

export function layoutHershey(font: HersheyFont, text: string, opts: HersheyLayoutOpts): LineSet {
  const n = countHersheySegments(font, text);
  const set = createLineSet(n, { width: true, flags: true });
  writeHershey(set, font, text, opts);
  return set;
}

/**
 * Cylindrical billboard: keep Y up, yaw so +Z faces the camera on XZ.
 * Glyphs are authored in XY (Z = 0).
 */
export function hersheyBillboard(out: Matrix4, origin: Vec3, cameraPos: Vec3): Matrix4 {
  _look.set(cameraPos.x - origin.x, 0, cameraPos.z - origin.z);
  if (_look.lengthSq() < 1e-10) _look.set(0, 0, 1);
  else _look.normalize();
  _right.crossVectors(_up, _look);
  if (_right.lengthSq() < 1e-10) _right.set(1, 0, 0);
  else _right.normalize();
  _look.crossVectors(_right, _up);
  out.makeBasis(_right, _up, _look);
  out.setPosition(origin.x, origin.y, origin.z);
  return out;
}

/**
 * World-space capital height that projects to `capPx` at `distance` in front
 * of a perspective camera (screen-space Hershey via a camera-parented batch).
 */
export function hersheyCapWorldForPixels(
  capPx: number,
  distance: number,
  fovDeg: number,
  cssHeight: number,
): number {
  const h = Math.max(cssHeight, 1);
  const worldH = 2 * Math.tan(((fovDeg * Math.PI) / 180) * 0.5) * Math.abs(distance);
  return (capPx / h) * worldH;
}

export function asciiRange(from = ASCII_START, to = ASCII_END): string {
  let s = '';
  for (let c = from; c <= to; c++) s += String.fromCharCode(c);
  return s;
}

/** Screen-space Hershey is camera-parented; skip distance fog. */
export const HERSHEY_SCREEN_FLAGS = BeamFlag.NO_FOG;

export { Beam, BeamFlag };
