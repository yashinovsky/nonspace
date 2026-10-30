/**
 * Phase Lock: pure math for the breach mechanic (plan §3.5, contract §9.3).
 * No DOM, no clock, no randomness. Validated by the M4.1 lab in `prototypes/phase-lock/`,
 * which imports this module.
 *
 * Conventions
 * - A layer signature is an integer ratio `a:b` plus a **figure phase** `phi` in [0, 2π).
 *   The target figure is x = sin(a·θ + phi/b), y = sin(b·θ). An integer Lissajous figure repeats
 *   when its x phase moves by 2π/b, so dividing by b makes every phi a distinct picture
 *   (except its time-reversed twin, see `reversedPhase`).
 * - The breaker's x oscillator rides the ICE carrier and the ratio knob R sets y/x, so R matches
 *   at R = b/a. The breaker's **observed phase** is the phase knob plus its accumulated roll
 *   (`stepRoll`): a slightly-off ratio makes the figure creep, exactly like a real scope, and the
 *   metric scores what the player sees.
 */

export const TAU = Math.PI * 2;

/** Scope sweep: the target figure closes once per 1/SCOPE_HZ seconds; sets the visual roll speed. */
export const SCOPE_HZ = 1.0;

/** Lock meter fills while m >= this (plan §3.5). */
export const LOCK_THRESHOLD = 0.85;
/** Dissonance feedback applies while m < this (plan §3.5). */
export const DISSONANCE_THRESHOLD = 0.3;
/** Drain rate relative to the fill rate while m < LOCK_THRESHOLD. */
export const DRAIN_FACTOR = 0.5;
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 4;
export const LN_RATIO_MIN = Math.log(RATIO_MIN);
export const LN_RATIO_MAX = Math.log(RATIO_MAX);

export type Ratio = readonly [a: number, b: number];

/** Wrap an angle to (-π, π]. */
export function wrapAngle(x: number): number {
  let y = x % TAU;
  if (y <= -Math.PI) y += TAU;
  else if (y > Math.PI) y -= TAU;
  return y;
}

/** Wrap an angle to [0, 2π). */
export function wrapPositive(x: number): number {
  const y = x % TAU;
  return y < 0 ? y + TAU : y;
}

/** |ln(R) − ln(b/a)|, in log units (tolRatio is in the same units). */
export function ratioError(R: number, a: number, b: number): number {
  return Math.abs(Math.log(R) - Math.log(b / a));
}

/** mR = exp(−(ratioErr / tolRatio)²) */
export function ratioMatch(R: number, a: number, b: number, tol: number): number {
  const e = ratioError(R, a, b) / tol;
  return Math.exp(-e * e);
}

/**
 * The same figure traced backwards (θ → c − θ) has figure phase (b − a)·π − phi, so the two
 * phases draw an identical point set: −phi when a and b are both odd, π − phi otherwise.
 * A static scope picture can't tell them apart, so the metric accepts either.
 */
export function reversedPhase(phi: number, a: number, b: number): number {
  return wrapPositive((b - a) * Math.PI - phi);
}

/** Signed figure-phase error to the nearer of phi and its twin, in (−π, π]. */
export function phaseError(Phi: number, phi: number, a: number, b: number): number {
  const d = wrapAngle(Phi - phi);
  const dr = wrapAngle(Phi - reversedPhase(phi, a, b));
  return Math.abs(dr) < Math.abs(d) ? dr : d;
}

/** mP = (0.5 + 0.5·cos(Φ − φ))⁴, measured to the nearer twin. */
export function phaseMatch(Phi: number, phi: number, a: number, b: number): number {
  const c = 0.5 + 0.5 * Math.cos(phaseError(Phi, phi, a, b));
  const c2 = c * c;
  return c2 * c2;
}

/**
 * Phase Lock match metric m = mR · mP, in 0..1 (plan §3.5, §9.3).
 * R = breaker ratio; Phi = breaker's observed figure phase (knob + roll); a:b, phi = target
 * ratio and figure phase; tol = tolRatio (log units).
 */
export function matchMetric(
  R: number,
  Phi: number,
  a: number,
  b: number,
  phi: number,
  tol: number,
): number {
  return ratioMatch(R, a, b, tol) * phaseMatch(Phi, phi, a, b);
}

/**
 * Lock meter step: fill at 1/lockTime while m ≥ 0.85, else drain at half that
 * times `drainScale` (Dixie auto-hold uses 0.5). Clamped to [0, 1]. Fill is
 * unchanged by drainScale.
 */
export function stepLockMeter(
  meter: number,
  m: number,
  dt: number,
  lockTime: number,
  drainScale = 1,
): number {
  const rate = 1 / lockTime;
  const drain = drainScale < 0 ? 0 : drainScale;
  const next = m >= LOCK_THRESHOLD ? meter + rate * dt : meter - DRAIN_FACTOR * drain * rate * dt;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

/** Re-key: back to 50% if you were above 50%, otherwise to 0. */
export function rekeyMeterReset(meter: number): number {
  return meter > 0.5 ? 0.5 : 0;
}

/**
 * Visible roll of the breaker figure in figure cycles per second (signed).
 * The breaker's y runs at R·a·scopeHz against the target's b·scopeHz, which advances its
 * apparent figure phase by −2π·a·(R·a − b)·scopeHz rad/s: proportional to the frequency
 * difference, zero (frozen) at R = b/a.
 */
export function rollRate(R: number, a: number, b: number, scopeHz = SCOPE_HZ): number {
  return -a * (R * a - b) * scopeHz;
}

/** Integrate the breaker's roll. Observed phase = phase knob + roll. */
export function stepRoll(
  roll: number,
  R: number,
  a: number,
  b: number,
  dt: number,
  scopeHz = SCOPE_HZ,
): number {
  return wrapPositive(roll + TAU * rollRate(R, a, b, scopeHz) * dt);
}

/** Audible beat between the breaker's and the ICE's right-channel tones, in Hz. */
export function beatHz(R: number, a: number, b: number, f0: number): number {
  return Math.abs(R * a - b) * f0;
}

// ---------------------------------------------------------------------------------------------
// Figures

export interface Figure {
  x: Float32Array;
  y: Float32Array;
}

/** One full period of the target figure, ending at θ = thetaNow (the beam head). */
export function sampleTarget(
  a: number,
  b: number,
  phi: number,
  thetaNow: number,
  n: number,
  out?: Figure,
): Figure {
  const f = out ?? { x: new Float32Array(n), y: new Float32Array(n) };
  const p = phi / b;
  for (let i = 0; i < n; i++) {
    const th = thetaNow - TAU + (TAU * i) / (n - 1);
    f.x[i] = Math.sin(a * th + p);
    f.y[i] = Math.sin(b * th);
  }
  return f;
}

/**
 * The breaker figure over the same window at observed phase `phase`. Within the window y runs
 * at R·a, so an off ratio also leaves the figure open and skewed; the slow roll comes from
 * `stepRoll`. Identical to the target when R = b/a and phase = phi.
 */
export function sampleBreaker(
  R: number,
  phase: number,
  a: number,
  b: number,
  thetaNow: number,
  n: number,
  out?: Figure,
): Figure {
  const f = out ?? { x: new Float32Array(n), y: new Float32Array(n) };
  const p = phase / b;
  const ry = R * a;
  const y0 = b * thetaNow;
  for (let i = 0; i < n; i++) {
    const s = -TAU + (TAU * i) / (n - 1);
    f.x[i] = Math.sin(a * (thetaNow + s) + p);
    f.y[i] = Math.sin(y0 + ry * s);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// Ratio knob with soft detents

/** Reduced p/q with p, q ≤ maxTerm inside [RATIO_MIN, RATIO_MAX], ascending, as ln values. */
export function buildDetents(maxTerm = 6): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let q = 1; q <= maxTerm; q++) {
    for (let p = 1; p <= maxTerm; p++) {
      const v = p / q;
      if (v < RATIO_MIN - 1e-9 || v > RATIO_MAX + 1e-9) continue;
      const key = v.toFixed(9);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(Math.log(v));
    }
  }
  return out.sort((x, y) => x - y);
}

export const DETENTS_LN = buildDetents(6);

/** Half-width of a detent's sticky zone in log units. Must stay below half the tightest gap. */
export const DETENT_WIDTH = 0.012;

/**
 * Map the raw knob position u (ln R, accumulated from input) to the effective ln R.
 * Inside ±width of a detent the output follows a cubic, so it barely moves near the centre
 * (stickiness you can feel) and rejoins the identity at the zone edge.
 */
export function applyDetent(
  u: number,
  detents: readonly number[] = DETENTS_LN,
  width = DETENT_WIDTH,
): number {
  let best = Infinity;
  let d0 = 0;
  for (const d of detents) {
    const dist = Math.abs(u - d);
    if (dist < best) {
      best = dist;
      d0 = d;
    }
  }
  if (best >= width) return u;
  const s = (u - d0) / width;
  return d0 + width * s * s * s;
}

export function clampLnR(u: number): number {
  return u < LN_RATIO_MIN ? LN_RATIO_MIN : u > LN_RATIO_MAX ? LN_RATIO_MAX : u;
}

/** Knob → R. Purist mode disables detents. */
export function knobToR(u: number, purist = false): number {
  const c = clampLnR(u);
  return Math.exp(purist ? c : applyDetent(c));
}
