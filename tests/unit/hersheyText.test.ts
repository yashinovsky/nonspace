import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import duplexJson from '../fixtures/fonts/hershey/duplex.json';
import simplexJson from '../fixtures/fonts/hershey/simplex.json';
import { Beam, createLineSet, lineSetCount } from '../../src/render/lines/BeamBatch';
import {
  ASCII_END,
  ASCII_START,
  asciiRange,
  countHersheySegments,
  hersheyBillboard,
  hersheyCapWorldForPixels,
  isAsciiPrintable,
  layoutHershey,
  measureHershey,
  decodeHersheyBytes,
  isGzip,
  parseHersheyFont,
  parseHersheyPacked,
  writeHershey,
  type HersheyFont,
  type HersheyFontJson,
} from '../../src/render/text/HersheyText';

function loadFont(json: unknown) {
  return parseHersheyFont(json as HersheyFontJson);
}

describe('HersheyText', () => {
  const simplex = loadFont(simplexJson);
  const duplex = loadFont(duplexJson);
  const ascii = asciiRange();

  it('covers printable ASCII 32–126 in simplex and duplex', () => {
    expect(ascii.length).toBe(ASCII_END - ASCII_START + 1);
    for (let c = ASCII_START; c <= ASCII_END; c++) {
      const ch = String.fromCharCode(c);
      expect(isAsciiPrintable(ch)).toBe(true);
      expect(simplex.glyphs[ch], `simplex ${ch}`).toBeDefined();
      expect(duplex.glyphs[ch], `duplex ${ch}`).toBeDefined();
    }
  });

  it('gives A a positive cap height and H a 21-unit stem', () => {
    expect(simplex.cap).toBeGreaterThanOrEqual(20);
    const h = simplex.glyphs['H']!;
    const ys = h.s.flat().filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(20);
    expect(Math.min(...ys)).toBeLessThanOrEqual(1);
    expect(countHersheySegments(simplex, 'A')).toBeGreaterThan(0);
    expect(countHersheySegments(simplex, ' ')).toBe(0);
  });

  it('layouts ASCII without allocating past the counted size', () => {
    const n = countHersheySegments(simplex, ascii);
    expect(n).toBeGreaterThan(200);
    const set = layoutHershey(simplex, ascii, { capHeight: 16, color: Beam.GRID });
    expect(lineSetCount(set)).toBe(n);
    const reused = createLineSet(n, { width: true, flags: true });
    expect(writeHershey(reused, simplex, ascii, { capHeight: 16, color: Beam.ICE })).toBe(n);
  });

  it('measures width as scaled advances and honors align', () => {
    const cap = simplex.cap;
    const m = measureHershey(simplex, 'HH', cap);
    expect(m.width).toBeCloseTo(simplex.glyphs['H']!.w * 2, 6);
    const left = layoutHershey(simplex, 'H', {
      capHeight: cap,
      color: Beam.GRID,
      align: 'left',
    });
    const center = layoutHershey(simplex, 'H', {
      capHeight: cap,
      color: Beam.GRID,
      align: 'center',
    });
    const advance = simplex.glyphs['H']!.w;
    expect(center.positions[0]).toBeCloseTo(left.positions[0]! - advance / 2, 5);
  });

  it('billboards so +Z faces the camera on XZ', () => {
    const out = new Matrix4();
    hersheyBillboard(out, { x: 0, y: 1, z: 0 }, { x: 0, y: 4, z: 10 });
    const e = out.elements;
    expect(e[12]).toBe(0);
    expect(e[13]).toBe(1);
    expect(e[14]).toBe(0);
    // Column 2 (+Z of the glyph plane) points toward the camera (+Z).
    expect(e[10]).toBeGreaterThan(0.9);
    expect(Math.abs(e[8])).toBeLessThan(0.05);
  });

  it('maps 16 px cap at 1080p / 75° / 2.4 u to a world height', () => {
    const h = hersheyCapWorldForPixels(16, 2.4, 75, 1080);
    expect(h).toBeGreaterThan(0.04);
    expect(h).toBeLessThan(0.12);
  });

  it('round-trips simplex through the packed runtime dump', () => {
    const fromPacked = parseHersheyPacked(packHershey(simplex), 'simplex');
    expect(fromPacked.cap).toBe(simplex.cap);
    expect(fromPacked.desc).toBe(simplex.desc);
    for (const ch of ascii) {
      expect(fromPacked.glyphs[ch]?.w).toBe(simplex.glyphs[ch]?.w);
      expect(fromPacked.glyphs[ch]?.s).toEqual(simplex.glyphs[ch]?.s);
    }
  });

  it('gunzips packed bytes only when the gzip magic is present', async () => {
    const packed = packHershey(simplex);
    expect(isGzip(packed)).toBe(false);
    expect(await decodeHersheyBytes(packed)).toBe(packed);
    const packedCopy = new Uint8Array(packed.byteLength);
    packedCopy.set(packed);
    const gz = new Uint8Array(
      await new Response(
        new Blob([packedCopy.buffer]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    expect(isGzip(gz)).toBe(true);
    const round = await decodeHersheyBytes(gz);
    expect(isGzip(round)).toBe(false);
    expect([...round]).toEqual([...packed]);
  });
});

function packHershey(font: HersheyFont): Uint8Array {
  const i8 = (n: number): number => (n < 0 ? (n + 256) & 255 : n & 255);
  const buf: number[] = [font.cap & 255, i8(font.desc)];
  for (let c = ASCII_START; c <= ASCII_END; c++) {
    const g = font.glyphs[String.fromCharCode(c)]!;
    buf.push(g.w & 255, g.s.length);
    for (const s of g.s) {
      buf.push(s.length / 2);
      for (const v of s) buf.push(i8(v));
    }
  }
  return Uint8Array.from(buf);
}
