/**
 * Matrix address as typed on the deck (plan §3.4, §8.6), e.g.
 * `BAMA 0412.77 / 1180.03 / 0250`. Parsing/formatting is owned by M2.3/M2.6.
 */
export interface MatrixCoord {
  /** Region code from regions.png, e.g. 'BAMA', 'CHBA', 'EURO', 'RIO', 'ORBT'. */
  region: string;
  /** Sector units (sector.fraction), 0..512. */
  x: number;
  /** Sector units (sector.fraction), 0..256. */
  z: number;
  /** Altitude in world units. */
  y: number;
}

export const SECTOR_SIZE = 1024;
export const WORLD_SECTORS_X = 512;
export const WORLD_SECTORS_Z = 256;
