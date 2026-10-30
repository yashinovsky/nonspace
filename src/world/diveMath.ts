/**
 * Kuang tube-dive sim (plan §4.4 M5 Phase C). Pure: polygonal tube lanes,
 * constant-speed camera, countermeasure crawlers, segment gates.
 */

import { Pcg32 } from '../core/rng';
import { ICE_LAYER_PRESETS } from '../content/ice/presets';

export const DIVE_LANE_MIN = 8;
export const DIVE_LANE_MAX = 16;
export const DIVE_LANES_DEFAULT = 12;
export const DIVE_SEGMENTS = 3;
export const DIVE_SPEED = 28;
export const DIVE_SEGMENT_LENGTH = 72;
export const DIVE_TUBE_RADIUS = 7.2;
export const DIVE_GATE_WINDOW = 5.5;
export const DIVE_LANE_DEADZONE = 0.35;
export const DIVE_LANE_REPEAT = 0.14;
export const DIVE_CRAWLER_SPEED = 11;
export const DIVE_HIT_Z = 1.8;
export const DIVE_INVULN = 0.7;
export const DIVE_CRAWLERS_PER_SEG = 3;

/** Generous Phase Lock tolerance from the kuang-gate preset (plan §12.3). */
export const KUANG_GATE_TOL = ICE_LAYER_PRESETS['kuang-gate'].tolRatio;
export const KUANG_GATE_LOCK_TIME = ICE_LAYER_PRESETS['kuang-gate'].lockTime;

export type DivePhase = 'flight' | 'gate' | 'done';

export interface Crawler {
  lane: number;
  z: number;
  alive: boolean;
}

export interface DiveInput {
  /** Strafe axis −1..1 (A/D, left stick). */
  strafe: number;
  dt: number;
}

export interface DiveState {
  t: number;
  /** Camera / player z. Starts 0 and decreases (into the throat). */
  z: number;
  lane: number;
  lanes: number;
  speed: number;
  radius: number;
  segment: number;
  phase: DivePhase;
  hits: number;
  invuln: number;
  crawlers: Crawler[];
  /** Latch so a held stick is one lane step, then repeat. */
  strafeHeld: boolean;
  repeatT: number;
  gatesCleared: number;
}

export function clampLanes(n: number): number {
  const v = n | 0;
  return v < DIVE_LANE_MIN ? DIVE_LANE_MIN : v > DIVE_LANE_MAX ? DIVE_LANE_MAX : v;
}

export function wrapLane(lane: number, lanes: number): number {
  const n = lanes | 0;
  if (n <= 0) return 0;
  let i = lane | 0;
  i %= n;
  if (i < 0) i += n;
  return i;
}

/** Lane centre angle. 0 = +X, increasing CCW (Tempest rim). */
export function laneAngle(lane: number, lanes: number): number {
  return ((wrapLane(lane, lanes) + 0.5) / lanes) * Math.PI * 2;
}

export function lanePos(
  lane: number,
  lanes: number,
  radius: number,
  z: number,
): {
  x: number;
  y: number;
  z: number;
} {
  const a = laneAngle(lane, lanes);
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z };
}

export function gateZ(segment: number, length = DIVE_SEGMENT_LENGTH): number {
  return -(segment + 1) * length;
}

export function segmentOfZ(z: number, length = DIVE_SEGMENT_LENGTH): number {
  const d = -z;
  const s = Math.floor(d / length);
  return s < 0 ? 0 : s > DIVE_SEGMENTS - 1 ? DIVE_SEGMENTS - 1 : s;
}

/**
 * One crisp lane step. Deadzoned stick: first tick past the threshold steps
 * once; hold-repeat after `DIVE_LANE_REPEAT`. Constant forward speed is the
 * caller's job — this never touches `z`.
 */
export function stepLane(
  lane: number,
  lanes: number,
  strafe: number,
  held: boolean,
  repeatT: number,
  dt: number,
): { lane: number; held: boolean; repeatT: number; stepped: boolean } {
  const n = clampLanes(lanes);
  if (!(Math.abs(strafe) >= DIVE_LANE_DEADZONE)) {
    return { lane: wrapLane(lane, n), held: false, repeatT: 0, stepped: false };
  }
  const dir = strafe > 0 ? 1 : -1;
  if (!held) {
    return {
      lane: wrapLane(lane + dir, n),
      held: true,
      repeatT: DIVE_LANE_REPEAT,
      stepped: true,
    };
  }
  const nextT = repeatT - dt;
  if (nextT > 0) return { lane: wrapLane(lane, n), held: true, repeatT: nextT, stepped: false };
  return {
    lane: wrapLane(lane + dir, n),
    held: true,
    repeatT: DIVE_LANE_REPEAT,
    stepped: true,
  };
}

export function spawnCrawlers(seed: number, lanes: number): Crawler[] {
  const rng = new Pcg32(seed, 0x71be);
  const n = clampLanes(lanes);
  const out: Crawler[] = [];
  for (let seg = 0; seg < DIVE_SEGMENTS; seg++) {
    const z0 = -seg * DIVE_SEGMENT_LENGTH - 10;
    const z1 = gateZ(seg) + DIVE_GATE_WINDOW + 4;
    for (let i = 0; i < DIVE_CRAWLERS_PER_SEG; i++) {
      const z = rng.float(Math.min(z0, z1), Math.max(z0, z1));
      out.push({ lane: rng.below(n), z, alive: true });
    }
  }
  return out;
}

export function crawlerHits(c: Crawler, lane: number, z: number): boolean {
  if (!c.alive) return false;
  if (c.lane !== lane) return false;
  return Math.abs(c.z - z) <= DIVE_HIT_Z;
}

export function createDiveState(
  opts: { lanes?: number; seed?: number; speed?: number } = {},
): DiveState {
  const lanes = clampLanes(opts.lanes ?? DIVE_LANES_DEFAULT);
  return {
    t: 0,
    z: 0,
    lane: 0,
    lanes,
    speed: opts.speed ?? DIVE_SPEED,
    radius: DIVE_TUBE_RADIUS,
    segment: 0,
    phase: 'flight',
    hits: 0,
    invuln: 0,
    crawlers: spawnCrawlers(opts.seed ?? 1, lanes),
    strafeHeld: false,
    repeatT: 0,
    gatesCleared: 0,
  };
}

export interface DiveStepResult {
  hit: boolean;
  enteredGate: boolean;
  finished: boolean;
}

/**
 * Advance flight: constant −Z speed, crisp lane steps, crawlers crawl toward
 * the camera (z increases). Does not run Phase Lock — the mode does that
 * while `phase === 'gate'`.
 */
export function stepDive(state: DiveState, input: DiveInput): DiveStepResult {
  const dt = input.dt;
  const result: DiveStepResult = { hit: false, enteredGate: false, finished: false };
  if (!(dt > 0) || state.phase === 'done') return result;

  const laneMove = stepLane(
    state.lane,
    state.lanes,
    input.strafe,
    state.strafeHeld,
    state.repeatT,
    dt,
  );
  state.lane = laneMove.lane;
  state.strafeHeld = laneMove.held;
  state.repeatT = laneMove.repeatT;

  if (state.phase === 'gate') {
    state.t += dt;
    return result;
  }

  state.t += dt;
  state.z -= state.speed * dt;
  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);

  for (const c of state.crawlers) {
    if (!c.alive) continue;
    c.z += DIVE_CRAWLER_SPEED * dt;
    if (c.z > state.z + 8) c.alive = false;
  }

  if (state.invuln <= 0) {
    for (const c of state.crawlers) {
      if (crawlerHits(c, state.lane, state.z)) {
        c.alive = false;
        state.hits += 1;
        state.invuln = DIVE_INVULN;
        result.hit = true;
        break;
      }
    }
  }

  const g = gateZ(state.segment);
  if (state.z <= g + DIVE_GATE_WINDOW) {
    state.z = g + DIVE_GATE_WINDOW;
    state.phase = 'gate';
    result.enteredGate = true;
  }
  return result;
}

/** Clear the current gate and resume, or finish after the last segment. */
export function clearGate(state: DiveState): 'flight' | 'done' | false {
  if (state.phase !== 'gate') return false;
  state.gatesCleared += 1;
  state.segment += 1;
  if (state.segment >= DIVE_SEGMENTS) {
    state.phase = 'done';
    state.segment = DIVE_SEGMENTS - 1;
    return 'done';
  }
  state.phase = 'flight';
  state.z = gateZ(state.segment - 1) + DIVE_GATE_WINDOW - 0.5;
  return 'flight';
}
