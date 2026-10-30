/**
 * Rasterize the first-pass density / region maps (plan §8.6).
 * Keep blob constants in sync with src/world/densityMap.ts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const W = 512;
const H = 256;

/** @type {Record<string, readonly [number, number, number]>} */
const REGION_RGB = {
  VOID: [0, 0, 0],
  BAMA: [28, 56, 168],
  CHBA: [176, 36, 44],
  EURO: [176, 164, 28],
  RIO: [28, 132, 68],
  ORBT: [160, 168, 196],
};

/** @typedef {{ sx: number, sz: number, rx: number, rz: number, amp: number, region: string }} Blob */

/** @type {Blob[]} */
const BLOBS = [
  { sx: 148, sz: 72, rx: 58, rz: 30, amp: 1, region: 'BAMA' },
  { sx: 132, sz: 90, rx: 24, rz: 18, amp: 0.45, region: 'BAMA' },
  { sx: 448, sz: 76, rx: 16, rz: 13, amp: 1, region: 'CHBA' },
  { sx: 268, sz: 56, rx: 24, rz: 16, amp: 0.9, region: 'EURO' },
  { sx: 255, sz: 64, rx: 10, rz: 8, amp: 0.35, region: 'EURO' },
  { sx: 196, sz: 168, rx: 20, rz: 16, amp: 0.75, region: 'RIO' },
];

const ORBITAL = { z0: 4, z1: 14, amp: 0.42 };

/**
 * @param {number} px
 * @param {number} pz
 * @param {Blob} b
 */
function blobWeight(px, pz, b) {
  const dx = (px - b.sx) / b.rx;
  const dz = (pz - b.sz) / b.rz;
  return b.amp * Math.exp(-0.5 * (dx * dx + dz * dz));
}

/** @param {number} pz */
function orbitalWeight(pz) {
  if (pz < ORBITAL.z0 || pz > ORBITAL.z1) return 0;
  const t = (pz - ORBITAL.z0) / (ORBITAL.z1 - ORBITAL.z0);
  const bell = Math.sin(t * Math.PI);
  return ORBITAL.amp * bell * bell;
}

const density = new PNG({ width: W, height: H, colorType: 6 });
const regions = new PNG({ width: W, height: H, colorType: 6 });
const floor = 0.03;

for (let z = 0; z < H; z++) {
  for (let x = 0; x < W; x++) {
    let d = floor;
    let best = 0;
    let bestCode = 'VOID';
    for (const b of BLOBS) {
      const w = blobWeight(x, z, b);
      d += w;
      if (w > best) {
        best = w;
        bestCode = b.region;
      }
    }
    const orb = orbitalWeight(z);
    d += orb;
    if (orb > best && orb > 0.08) {
      best = orb;
      bestCode = 'ORBT';
    }
    if (best < 0.08) bestCode = 'VOID';
    if (d < 0) d = 0;
    else if (d > 1) d = 1;
    const i = (z * W + x) * 4;
    const g = (d * 255 + 0.5) | 0;
    density.data[i] = g;
    density.data[i + 1] = g;
    density.data[i + 2] = g;
    density.data[i + 3] = 255;
    const rgb = REGION_RGB[bestCode] ?? REGION_RGB.VOID;
    regions.data[i] = rgb[0];
    regions.data[i + 1] = rgb[1];
    regions.data[i + 2] = rgb[2];
    regions.data[i + 3] = 255;
  }
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/data');
writeFileSync(join(dir, 'density.png'), PNG.sync.write(density, { colorType: 0 }));
writeFileSync(join(dir, 'regions.png'), PNG.sync.write(regions));
console.log('wrote', join(dir, 'density.png'), join(dir, 'regions.png'));
