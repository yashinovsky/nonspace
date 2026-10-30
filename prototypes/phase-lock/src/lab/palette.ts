/** Beam palette (plan §5.3). RGB 0–255 at nominal intensity. */
export type RGB = readonly [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const BEAM = {
  GRID: hex('#A8D8FF'),
  AFTERGLOW: hex('#C6F03A'),
  MITSU: hex('#4DFF5A'),
  TA: hex('#14C77A'),
  ESFA: hex('#FF3B1F'),
  AMBER: hex('#FFB000'),
  ICE: hex('#E4FFFF'),
  MIL: hex('#B9A6FF'),
} as const;

export const SPECIAL = {
  BLACK_ICE_EDGE: hex('#8A2BFF'),
  VFD: hex('#3CF0D0'),
} as const;

/** Hot = whiter: phosphor saturates toward white above nominal intensity (1.0 … 4.0). */
export function hot(c: RGB, intensity: number): RGB {
  const k = Math.max(0, Math.min(1, (intensity - 1) / 3)) * 0.6;
  return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
