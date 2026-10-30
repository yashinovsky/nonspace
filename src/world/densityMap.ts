/**
 * Authored 512×256 density / region rasters (plan §8.6). Blobs are an
 * abstracted 1980s data-exchange map — no coastlines. Pixels are sectors.
 */

import { WORLD_SECTORS_X, WORLD_SECTORS_Z, clampSectorIndex } from './coords';

export const DENSITY_WIDTH = WORLD_SECTORS_X;
export const DENSITY_HEIGHT = WORLD_SECTORS_Z;

export const REGION_CODES = ['VOID', 'BAMA', 'CHBA', 'EURO', 'RIO', 'ORBT'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export const REGION_RGB: Record<RegionCode, readonly [number, number, number]> = {
  VOID: [0, 0, 0],
  BAMA: [28, 56, 168],
  CHBA: [176, 36, 44],
  EURO: [176, 164, 28],
  RIO: [28, 132, 68],
  ORBT: [160, 168, 196],
};

/** First-pass authored blobs. Coordinates are sector indices (image pixels). */
export const DENSITY_BLOBS: readonly {
  sx: number;
  sz: number;
  rx: number;
  rz: number;
  amp: number;
  region: Exclude<RegionCode, 'VOID' | 'ORBT'>;
}[] = [
  { sx: 148, sz: 72, rx: 58, rz: 30, amp: 1, region: 'BAMA' },
  { sx: 132, sz: 90, rx: 24, rz: 18, amp: 0.45, region: 'BAMA' },
  { sx: 448, sz: 76, rx: 16, rz: 13, amp: 1, region: 'CHBA' },
  { sx: 268, sz: 56, rx: 24, rz: 16, amp: 0.9, region: 'EURO' },
  { sx: 255, sz: 64, rx: 10, rz: 8, amp: 0.35, region: 'EURO' },
  { sx: 196, sz: 168, rx: 20, rz: 16, amp: 0.75, region: 'RIO' },
];

/** Thin high-latitude strip: Freeside / orbital band. No geography. */
export const ORBITAL_BAND = { z0: 4, z1: 14, amp: 0.42 } as const;

export interface DensityMaps {
  readonly width: number;
  readonly height: number;
  /** Grayscale 0..255, row-major `z * width + x`. */
  readonly density: Uint8Array;
  /** Region index into REGION_CODES, same layout. */
  readonly region: Uint8Array;
  sample(sx: number, sz: number): number;
  regionCode(sx: number, sz: number): RegionCode;
  at(sx: number, sz: number): { density: number; region: RegionCode };
}

function packRgb(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

let RGB_INDEX: Map<number, RegionCode> | null = null;

function rgbIndex(): Map<number, RegionCode> {
  if (RGB_INDEX) return RGB_INDEX;
  RGB_INDEX = new Map();
  for (const code of REGION_CODES) {
    const [r, g, b] = REGION_RGB[code];
    RGB_INDEX.set(packRgb(r, g, b), code);
  }
  return RGB_INDEX;
}

export function rgbToRegion(r: number, g: number, b: number): RegionCode {
  const exact = rgbIndex().get(packRgb(r, g, b));
  if (exact) return exact;
  let best: RegionCode = 'VOID';
  let bestD = Infinity;
  for (const code of REGION_CODES) {
    const [pr, pg, pb] = REGION_RGB[code];
    const d = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}

export function regionIndex(code: string): number {
  const i = (REGION_CODES as readonly string[]).indexOf(code);
  return i < 0 ? 0 : i;
}

export function regionFromIndex(i: number): RegionCode {
  return REGION_CODES[i] ?? 'VOID';
}

function pixel(maps: { width: number; height: number }, sx: number, sz: number): number {
  const s = clampSectorIndex(sx, sz);
  return s.sz * maps.width + s.sx;
}

function bindMaps(
  width: number,
  height: number,
  density: Uint8Array,
  region: Uint8Array,
): DensityMaps {
  const maps: DensityMaps = {
    width,
    height,
    density,
    region,
    sample(sx, sz) {
      return density[pixel(maps, sx, sz)]! / 255;
    },
    regionCode(sx, sz) {
      return regionFromIndex(region[pixel(maps, sx, sz)]!);
    },
    at(sx, sz) {
      const i = pixel(maps, sx, sz);
      return { density: density[i]! / 255, region: regionFromIndex(region[i]!) };
    },
  };
  return maps;
}

export function mapsFromRasters(
  density: Uint8Array,
  region: Uint8Array,
  width = DENSITY_WIDTH,
  height = DENSITY_HEIGHT,
): DensityMaps {
  if (density.length < width * height || region.length < width * height) {
    throw new RangeError('density/region rasters are smaller than the map');
  }
  return bindMaps(width, height, density, region);
}

/** Decode 8-bit grayscale (or R of RGBA) and region RGB into maps. */
export function mapsFromRgba(
  densityRgba: Uint8Array,
  regionRgba: Uint8Array,
  width = DENSITY_WIDTH,
  height = DENSITY_HEIGHT,
): DensityMaps {
  const n = width * height;
  const density = new Uint8Array(n);
  const region = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    density[i] = densityRgba[i * 4]!;
    region[i] = regionIndex(
      rgbToRegion(regionRgba[i * 4]!, regionRgba[i * 4 + 1]!, regionRgba[i * 4 + 2]!),
    );
  }
  return bindMaps(width, height, density, region);
}

export function densityToRgba(maps: DensityMaps): Uint8Array {
  const n = maps.width * maps.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const g = maps.density[i]!;
    const o = i * 4;
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
    out[o + 3] = 255;
  }
  return out;
}

export function regionToRgba(maps: DensityMaps): Uint8Array {
  const n = maps.width * maps.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = REGION_RGB[regionFromIndex(maps.region[i]!)];
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

function blobWeight(px: number, pz: number, b: (typeof DENSITY_BLOBS)[number]): number {
  const dx = (px - b.sx) / b.rx;
  const dz = (pz - b.sz) / b.rz;
  return b.amp * Math.exp(-0.5 * (dx * dx + dz * dz));
}

function orbitalWeight(pz: number): number {
  if (pz < ORBITAL_BAND.z0 || pz > ORBITAL_BAND.z1) return 0;
  const t = (pz - ORBITAL_BAND.z0) / (ORBITAL_BAND.z1 - ORBITAL_BAND.z0);
  const bell = Math.sin(t * Math.PI);
  return ORBITAL_BAND.amp * bell * bell;
}

/** One sector of the first-pass blob table. Matches `createAuthoredMaps().at`. */
export function sampleAuthored(sx: number, sz: number): { density: number; region: RegionCode } {
  const s = clampSectorIndex(sx, sz);
  let d = 0.03;
  let best = 0;
  let bestCode: RegionCode = 'VOID';
  for (const b of DENSITY_BLOBS) {
    const w = blobWeight(s.sx, s.sz, b);
    d += w;
    if (w > best) {
      best = w;
      bestCode = b.region;
    }
  }
  const orb = orbitalWeight(s.sz);
  d += orb;
  if (orb > best && orb > 0.08) {
    best = orb;
    bestCode = 'ORBT';
  }
  if (best < 0.08) bestCode = 'VOID';
  if (d < 0) d = 0;
  else if (d > 1) d = 1;
  return { density: ((d * 255 + 0.5) | 0) / 255, region: bestCode };
}

/**
 * Rasterize the authored blob table. First-pass stand-in for a hand-painted
 * map; committed PNGs must match this function.
 */
export function createAuthoredMaps(): DensityMaps {
  const width = DENSITY_WIDTH;
  const height = DENSITY_HEIGHT;
  const density = new Uint8Array(width * height);
  const region = new Uint8Array(width * height);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const at = sampleAuthored(x, z);
      const i = z * width + x;
      density[i] = (at.density * 255 + 0.5) | 0;
      region[i] = regionIndex(at.region);
    }
  }
  return bindMaps(width, height, density, region);
}
