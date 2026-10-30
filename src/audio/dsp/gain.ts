/** dB ↔ linear amplitude. −80 dB and below is treated as silence. */
export function dbToLinear(db: number): number {
  if (!(db > -80)) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(gain: number): number {
  if (!(gain > 0)) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(gain);
}
