/**
 * Far-LOD landmark registry (plan §8.6). Always loaded, independent of
 * sector streaming. Authored heraldry lives in M2.2 `content/landmarks.ts`;
 * this is the streaming-side fallback. Do not edit M2.2 content files.
 */

import { sectorCenter } from './coords';

export interface LandmarkDef {
  id: string;
  /** Sector index X (0..511). */
  sx: number;
  /** Sector index Z (0..255). */
  sz: number;
  /** Altitude in world units. */
  y: number;
  /** Beam palette index (GRID/MITSU/TA/ESFA/AMBER/ICE/MIL). */
  color: number;
  importance: number;
}

/** Beam indices as literals so this file does not import BeamBatch (worker). */
const C = { GRID: 0, MITSU: 2, TA: 3, ESFA: 4, AMBER: 5, ICE: 6, MIL: 7 } as const;

/**
 * First-pass positions at density-map blob centers. M2.2 may replace these
 * via `createSectorStreamer({ landmarks })`; ids are stable for missions.
 */
export const FALLBACK_LANDMARKS: readonly LandmarkDef[] = [
  { id: 'ta-straylight', sx: 256, sz: 8, y: 6400, color: C.TA, importance: 8 },
  { id: 'ta-berne', sx: 268, sz: 56, y: 480, color: C.TA, importance: 6 },
  { id: 'mitsubishi-boa', sx: 148, sz: 72, y: 320, color: C.MITSU, importance: 6 },
  { id: 'esfa', sx: 140, sz: 80, y: 280, color: C.ESFA, importance: 7 },
  { id: 'sense-net', sx: 156, sz: 68, y: 220, color: C.AMBER, importance: 5 },
  { id: 'hosaka', sx: 448, sz: 76, y: 300, color: C.GRID, importance: 6 },
  { id: 'turing-geneva', sx: 255, sz: 64, y: 400, color: C.MIL, importance: 7 },
  { id: 'chiba-clinic', sx: 452, sz: 80, y: 60, color: C.ICE, importance: 4 },
  { id: 'hosaka-m3', sx: 440, sz: 74, y: 180, color: C.GRID, importance: 5 },
];

export function landmarkWorld(lm: LandmarkDef): { x: number; y: number; z: number } {
  const c = sectorCenter(lm.sx, lm.sz);
  return { x: c.x, y: lm.y, z: c.z };
}

export function resolveLandmarks(authored?: readonly LandmarkDef[]): readonly LandmarkDef[] {
  return authored && authored.length > 0 ? authored : FALLBACK_LANDMARKS;
}

export function nearestLandmark(
  landmarks: readonly LandmarkDef[],
  x: number,
  z: number,
): LandmarkDef | null {
  if (landmarks.length === 0) return null;
  let best = landmarks[0]!;
  let bestD = Infinity;
  for (const lm of landmarks) {
    const p = landmarkWorld(lm);
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = lm;
    }
  }
  return best;
}
