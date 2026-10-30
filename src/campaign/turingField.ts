/**
 * M4 Turing watcher corridor (M7.7). Pure placement + heat scaling so tests
 * can prove heat ≥ 2 is harder without spinning WebGL. Reuses M4.6 sim.
 */

import type { Difficulty } from '../core/settings';
import { createTrace } from '../deck/Trace';
import type { WatcherInstance } from '../world/Sector';
import { createWatcherSim, WATCHER_TRACE_RATE } from '../world/watchers/Watcher';
import { M4_HEAT_HARD } from '../content/missions/m4';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TuringFieldSpec {
  watcherCount: number;
  /** Planar offset from the corridor centreline (world units). */
  offset: number;
  /** Corridor length along −Z from the drop. Story shortens this. */
  corridor: number;
  stagger: boolean;
  skipIce: boolean;
}

export const TURING_FIELD_Y = 12;

/** Default local drop used by unit tests (no landmark import). */
export const TURING_TEST_DROP: Vec3 = { x: 0, y: TURING_FIELD_Y, z: 400 };

const DEG = Math.PI / 180;

export function turingFieldSpec(heat: number, difficulty: Difficulty = 'normal'): TuringFieldSpec {
  const h = Math.max(0, heat | 0);
  let n = 4;
  if (difficulty === 'story') n = 3;
  if (difficulty === 'hard') n = 6;
  if (h >= 1) n += 1;
  if (h >= M4_HEAT_HARD) n += 3;
  return {
    watcherCount: n,
    // Keep offset near the 14° cone's Z slice (~24 u at 96). Tighter offset
    // shrinks that slice and made heat 2 *easier* on the centreline.
    offset: h >= M4_HEAT_HARD ? 88 : 96,
    corridor: difficulty === 'story' ? 220 : 460,
    stagger: h >= M4_HEAT_HARD,
    skipIce: difficulty === 'story',
  };
}

export function turingStartFromDrop(drop: Vec3, spec: TuringFieldSpec): Vec3 {
  return { x: drop.x, y: drop.y, z: drop.z - spec.corridor };
}

/**
 * Place Turing watchers along the approach, alternating sides. Heat ≥ 2
 * packs them closer and staggers yaw so the centreline stays in a cone longer.
 */
export function placeTuringWatchers(
  heat: number,
  difficulty: Difficulty,
  drop: Vec3,
): WatcherInstance[] {
  const spec = turingFieldSpec(heat, difficulty);
  const start = turingStartFromDrop(drop, spec);
  const out: WatcherInstance[] = [];
  const n = spec.watcherCount;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const z = start.z + t * (drop.z - start.z);
    const side = i % 2 === 0 ? 1 : -1;
    const x = drop.x + side * spec.offset;
    const face = Math.atan2(drop.x - x, 0);
    // Small yaw fan (±8°) still covers the centreline at t=0; π-scale stagger did not.
    const yaw0 = spec.stagger ? face + ((i % 3) - 1) * (8 * DEG) : face;
    out.push({ x, y: drop.y, z, kind: 'turing', yaw0 });
  }
  return out;
}

/** Samples along the corridor centreline, drop last. Story uses fewer. */
export function stealthPath(heat: number, difficulty: Difficulty, drop: Vec3): Vec3[] {
  const spec = turingFieldSpec(heat, difficulty);
  const start = turingStartFromDrop(drop, spec);
  const steps = difficulty === 'story' ? 10 : 24;
  const path: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      x: drop.x,
      y: drop.y,
      z: start.z + t * (drop.z - start.z),
    });
  }
  return path;
}

export interface CorridorSample {
  watcherCount: number;
  exposedTime: number;
  trace: number;
  samples: number;
  skipIce: boolean;
}

/**
 * Drive the M4.6 sim along the centreline. Heat ≥ 2 must accumulate more
 * exposed time and trace on the same path length (tests assert this).
 */
export function measureCorridor(
  heat: number,
  difficulty: Difficulty = 'normal',
  drop: Vec3 = TURING_TEST_DROP,
): CorridorSample {
  const spec = turingFieldSpec(heat, difficulty);
  const watchers = placeTuringWatchers(heat, difficulty, drop);
  const path = stealthPath(heat, difficulty, drop);
  const trace = createTrace();
  const sim = createWatcherSim({
    watchers,
    trace,
    player: path[0],
  });
  const dt = 0.04;
  let exposedTime = 0;
  for (const p of path) {
    sim.setPlayer(p.x, p.y, p.z);
    sim.step(dt);
    if (sim.exposed) exposedTime += dt;
  }
  return {
    watcherCount: spec.watcherCount,
    exposedTime,
    trace: trace.value,
    samples: path.length,
    skipIce: spec.skipIce,
  };
}

export { WATCHER_TRACE_RATE };
