#!/usr/bin/env node
/**
 * M3.1 font conversion (plan §6.5, §8.11).
 *
 * Reads the Hershey JHF dumps (roman simplex / duplex), writes gzipped runtime
 * JSON under public/fonts/hershey/ and uncompressed fixtures for unit tests.
 *
 *   node scripts/convert-fonts.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'scripts/fonts');
const HERSHEY_OUT = join(ROOT, 'public/fonts/hershey');
const FIXTURE_OUT = join(ROOT, 'tests/fixtures/fonts/hershey');

const ASCII_START = 32;
const ASCII_END = 126;

/** Hershey origin is ASCII 'R'. */
const ORIGIN = 82;

/**
 * Parse one JHF glyph line (Kamal Mostafa / Usenet packed format).
 * Y in the dump increases downward; we emit Y-up with H's stem feet at 0
 * (cap height 21, matching the classic simplex grid).
 *
 * @param {string} line
 * @param {number} baselineY  max JHF-Y of 'H' (bottom of capital stems)
 */
function parseJhfGlyph(line, baselineY) {
  const n = Number.parseInt(line.slice(5, 8), 10);
  const rest = line.slice(8);
  const left = rest.charCodeAt(0) - ORIGIN;
  const right = rest.charCodeAt(1) - ORIGIN;
  const pairs = rest.slice(2);
  /** @type {number[][]} */
  const strokes = [];
  /** @type {number[]} */
  let cur = [];
  const expected = Math.max(0, n - 1);
  for (let i = 0; i < expected; i++) {
    const a = pairs.charCodeAt(i * 2);
    const b = pairs.charCodeAt(i * 2 + 1);
    if (Number.isNaN(a) || Number.isNaN(b)) break;
    if (a === 32 && b === ORIGIN) {
      if (cur.length >= 4) strokes.push(cur);
      cur = [];
      continue;
    }
    const x = a - ORIGIN - left;
    const y = baselineY - (b - ORIGIN);
    cur.push(x, y);
  }
  if (cur.length >= 4) strokes.push(cur);
  return { w: right - left, s: strokes };
}

/**
 * @param {string} name
 * @param {string} jhfPath
 */
function convertHershey(name, jhfPath) {
  const lines = readFileSync(jhfPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length >= 8);
  const glyphs = lines.slice(0, ASCII_END - ASCII_START + 1);
  const hLine = glyphs[65 - ASCII_START];
  if (!hLine) throw new Error(`${name}: missing H`);
  const hRest = hLine.slice(8);
  let baselineY = 9;
  const hN = Number.parseInt(hLine.slice(5, 8), 10);
  const hPairs = hRest.slice(2);
  for (let i = 0; i < hN - 1; i++) {
    const b = hPairs.charCodeAt(i * 2 + 1);
    if (hPairs.charCodeAt(i * 2) === 32 && b === ORIGIN) continue;
    baselineY = Math.max(baselineY, b - ORIGIN);
  }

  /** @type {Record<string, { w: number, s: number[][] }>} */
  const out = {};
  let cap = 0;
  let desc = 0;
  for (let code = ASCII_START; code <= ASCII_END; code++) {
    const line = glyphs[code - ASCII_START];
    if (!line) continue;
    const g = parseJhfGlyph(line, baselineY);
    out[String.fromCharCode(code)] = g;
    for (const stroke of g.s) {
      for (let i = 1; i < stroke.length; i += 2) {
        cap = Math.max(cap, stroke[i] ?? 0);
        desc = Math.min(desc, stroke[i] ?? 0);
      }
    }
  }
  return {
    name,
    cap,
    desc,
    first: ASCII_START,
    last: ASCII_END,
    glyphs: out,
  };
}

/** @param {number} n */
function i8(n) {
  return n < 0 ? (n + 256) & 255 : n & 255;
}

/**
 * Packed strokes: `[cap u8][desc i8]` then 95 glyphs of
 * `[w u8][nStrokes u8] { [nPoints u8] [x i8][y i8]... }`.
 * @param {{ cap: number, desc: number, glyphs: Record<string, { w: number, s: number[][] }> }} font
 */
function packHershey(font) {
  /** @type {number[]} */
  const buf = [font.cap & 255, i8(font.desc)];
  for (let c = ASCII_START; c <= ASCII_END; c++) {
    const g = font.glyphs[String.fromCharCode(c)];
    if (!g) throw new Error(`missing glyph ${String.fromCharCode(c)}`);
    buf.push(g.w & 255, g.s.length);
    for (const s of g.s) {
      buf.push(s.length / 2);
      for (const v of s) buf.push(i8(v));
    }
  }
  return Buffer.from(buf);
}

/**
 * @param {{ cap: number, desc: number, glyphs: Record<string, { w: number, s: number[][] }> }} font
 * @param {string} name
 * @param {boolean} ship
 */
function writeHershey(font, name, ship) {
  const json = `${JSON.stringify(font)}\n`;
  writeFileSync(join(FIXTURE_OUT, `${name}.json`), json);
  if (ship) {
    writeFileSync(join(HERSHEY_OUT, `${name}.bin.gz`), gzipSync(packHershey(font), { level: 9 }));
  }
}

function main() {
  mkdirSync(HERSHEY_OUT, { recursive: true });
  mkdirSync(FIXTURE_OUT, { recursive: true });

  const simplex = convertHershey('simplex', join(SRC, 'rowmans.jhf'));
  const duplex = convertHershey('duplex', join(SRC, 'rowmand.jhf'));
  writeHershey(simplex, 'simplex', true);
  writeHershey(duplex, 'duplex', false);

  const sizes = ['simplex.bin.gz'].map((rel) => {
    const n = readFileSync(join(HERSHEY_OUT, rel)).byteLength;
    return `  ${(n / 1024).toFixed(1)} KB  fonts/hershey/${rel}`;
  });
  const missing = [];
  for (let c = ASCII_START; c <= ASCII_END; c++) {
    const ch = String.fromCharCode(c);
    if (!simplex.glyphs[ch]) missing.push(`simplex:${ch}`);
    if (!duplex.glyphs[ch]) missing.push(`duplex:${ch}`);
  }
  if (missing.length) throw new Error(`missing glyphs ${missing.join(',')}`);
  console.log(`Hershey simplex cap=${simplex.cap} desc=${simplex.desc}`);
  console.log(`Hershey duplex  cap=${duplex.cap} desc=${duplex.desc}`);
  console.log(sizes.join('\n'));
}

main();
