/** Lock meter fills while m >= this (plan §3.5). */
export const LOCK_THRESHOLD = 0.85;
/** Dissonance feedback applies while m < this (plan §3.5). */
export const DISSONANCE_THRESHOLD = 0.3;
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 4;

/**
 * Phase Lock match metric (plan §3.5, §9.3), in 0..1.
 * R = player ratio knob, Phi = player phase; a:b, phi = target; tol = tolRatio (log units).
 */
export function matchMetric(
  R: number,
  Phi: number,
  a: number,
  b: number,
  phi: number,
  tol: number,
): number {
  const ratioErr = Math.abs(Math.log(R) - Math.log(b / a));
  const e = ratioErr / tol;
  const mR = Math.exp(-(e * e));
  const p = 0.5 + 0.5 * Math.cos(Phi - phi);
  const p2 = p * p;
  return mR * p2 * p2;
}
