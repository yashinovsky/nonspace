/**
 * Matrix coordinates and sector scale (plan §3.4, §8.6). Display form is
 * `BAMA 0148.50 / 0072.50 / 0120` — region + sector.fraction x/z + altitude.
 * The plan's `1180.03` example is illustrative; z is 0..WORLD_SECTORS_Z.
 */

export interface MatrixCoord {
  /** Region code from regions.png, e.g. 'BAMA', 'CHBA', 'EURO', 'RIO', 'ORBT'. */
  region: string;
  /** Sector units (sector.fraction), 0..WORLD_SECTORS_X. */
  x: number;
  /** Sector units (sector.fraction), 0..WORLD_SECTORS_Z. */
  z: number;
  /** Altitude in world units. */
  y: number;
}

export const MINOR_GRID = 8;
export const MAJOR_GRID = 64;
export const SUPER_GRID = 1024;
export const SECTOR_SIZE = SUPER_GRID;
export const WORLD_SECTORS_X = 512;
export const WORLD_SECTORS_Z = 256;
/** Active window is (2*r+1)^2 = 5×5 (plan §8.6). */
export const STREAM_RADIUS = 2;
export const WORLD_EXTENT_X = WORLD_SECTORS_X * SECTOR_SIZE;
export const WORLD_EXTENT_Z = WORLD_SECTORS_Z * SECTOR_SIZE;

export interface SectorIndex {
  sx: number;
  sz: number;
}

export function clampSectorIndex(sx: number, sz: number): SectorIndex {
  const x = Math.max(0, Math.min(WORLD_SECTORS_X - 1, sx | 0));
  const z = Math.max(0, Math.min(WORLD_SECTORS_Z - 1, sz | 0));
  return { sx: x, sz: z };
}

/** Floor world XZ to a sector index and clamp to the authored map. */
export function worldToSector(x: number, z: number): SectorIndex {
  return clampSectorIndex(Math.floor(x / SECTOR_SIZE), Math.floor(z / SECTOR_SIZE));
}

export function sectorOrigin(sx: number, sz: number): { x: number; z: number } {
  const s = clampSectorIndex(sx, sz);
  return { x: s.sx * SECTOR_SIZE, z: s.sz * SECTOR_SIZE };
}

export function sectorCenter(sx: number, sz: number): { x: number; z: number } {
  const o = sectorOrigin(sx, sz);
  const half = SECTOR_SIZE * 0.5;
  return { x: o.x + half, z: o.z + half };
}

export function sectorKey(sx: number, sz: number): string {
  const s = clampSectorIndex(sx, sz);
  return `${s.sx}:${s.sz}`;
}

export function parseSectorKey(key: string): SectorIndex {
  const i = key.indexOf(':');
  return clampSectorIndex(Number(key.slice(0, i)), Number(key.slice(i + 1)));
}

/** Quantize to the grid; positions must be snapped before hashing (plan §8.2). */
export function snapToGrid(v: number, grid: number = MAJOR_GRID): number {
  if (!(grid > 0) || !Number.isFinite(v)) return 0;
  return Math.round(v / grid) * grid;
}

export function worldToMatrixCoord(x: number, y: number, z: number, region: string): MatrixCoord {
  return {
    region,
    x: x / SECTOR_SIZE,
    z: z / SECTOR_SIZE,
    y,
  };
}

export function matrixCoordToWorld(c: MatrixCoord): { x: number; y: number; z: number } {
  return { x: c.x * SECTOR_SIZE, y: c.y, z: c.z * SECTOR_SIZE };
}

function padFixed(n: number, intDigits: number, frac: number): string {
  const sign = n < 0 ? '-' : '';
  const [i, f = ''] = Math.abs(n).toFixed(frac).split('.');
  return `${sign}${i.padStart(intDigits, '0')}${frac > 0 ? `.${f}` : ''}`;
}

/** `BAMA 0148.50 / 0072.50 / 0120` */
export function formatMatrixCoord(c: MatrixCoord): string {
  const y = Number.isFinite(c.y) ? c.y : 0;
  return `${c.region} ${padFixed(c.x, 4, 2)} / ${padFixed(c.z, 4, 2)} / ${padFixed(Math.round(y), 4, 0)}`;
}

const COORD_RE =
  /^(?:([A-Z]{3,4})\s+)?(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parseMatrixCoord(raw: string): MatrixCoord | null {
  const m = COORD_RE.exec(raw.trim().toUpperCase());
  if (!m) return null;
  return {
    region: m[1] ?? 'VOID',
    x: Number(m[2]),
    z: Number(m[3]),
    y: Number(m[4]),
  };
}
