/**
 * Turing / sysop watchers (M4.6). Sweep beams, detection cones, trace gain,
 * DECOY lure. GPU fans are BeamBatch vector wedges — 1984 PPI, not neon.
 *
 * Sector streaming stores `WatcherInstance` in `SectorData`. This module is
 * the runtime; the `?lab=watchers` chunk is the only default-boot-adjacent
 * importer so the field stays out of the 1 MB graph.
 */

import { Vector3, type Scene } from 'three';
import type { EventBus } from '../../core/events';
import type { Vec3 } from '../../core/math/vec3';
import type { Pcg32 } from '../../core/rng';
import type { RadarBlip } from '../../hud/Radar';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
  type LineSet,
} from '../../render/lines/BeamBatch';
import type { Palette } from '../../render/palette';
import { MINOR_GRID, snapToGrid } from '../coords';
import type { RegionCode } from '../densityMap';
import type { ConstructInstance, WatcherInstance } from '../Sector';

/** Plan §12.3: exposure while inside a sweep cone. %/s. */
export const WATCHER_TRACE_RATE = 6;
/** Turing Registry landmark rhythm (plan §5.4). */
export const TURING_SWEEP_HZ = 0.25;
/** Corporate sysop sweep — slower than Turing. */
export const SYSOP_SWEEP_HZ = 0.14;
/** DECOY duration / trace mul (plan §3.5 / §9.4). M4.4 owns charges. */
export const DECOY_SECONDS = 8;
export const DECOY_TRACE_MUL = 0.5;
/** Radar PPI range for blip radius (world units). */
export const WATCHER_RADAR_RANGE = 400;
export const MAX_WATCHERS = 24;
export const MAX_LURES = 2;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FAN_RAYS = 9;
const FAN_ARCS = 12;
const BODY_EDGES = 12;
const MARKER_EDGES = 6;

const _a = new Vector3();
const _b = new Vector3();

export type WatcherKind = WatcherInstance['kind'];

export interface WatcherSpec {
  kind: WatcherKind;
  hz: number;
  /** Half-angle of the detection wedge (radians). */
  halfCone: number;
  range: number;
  /** Vertical half-height of the slab cone. */
  height: number;
  beam: Beam;
  /** Yaw slew toward a lure (rad/s). */
  turnRate: number;
  body: number;
}

export const TURING_SPEC: WatcherSpec = {
  kind: 'turing',
  hz: TURING_SWEEP_HZ,
  halfCone: 14 * DEG,
  range: 160,
  height: 28,
  beam: Beam.MIL,
  turnRate: 2.8,
  body: 4.2,
};

export const SYSOP_SPEC: WatcherSpec = {
  kind: 'sysop',
  hz: SYSOP_SWEEP_HZ,
  halfCone: 22 * DEG,
  range: 110,
  height: 22,
  beam: Beam.AMBER,
  turnRate: 1.9,
  body: 3.2,
};

export function watcherSpec(kind: WatcherKind): WatcherSpec {
  return kind === 'turing' ? TURING_SPEC : SYSOP_SPEC;
}

/**
 * Lure dropped by DECOY (M4.4) or the lab stub. Watchers slew their sweep
 * toward this point for `remaining` seconds. Trace gain is multiplied by
 * `traceMul` while any lure is live (DECOY: ×0.5 for 8 s).
 */
export interface WatcherLure {
  x: number;
  y: number;
  z: number;
  remaining: number;
  traceMul: number;
}

export interface TraceSink {
  step(dt: number, rate: number): void;
}

export interface WatcherState {
  x: number;
  y: number;
  z: number;
  kind: WatcherKind;
  yaw0: number;
  yaw: number;
  exposed: boolean;
  lured: boolean;
}

export interface WatcherTarget {
  x: number;
  y: number;
  z: number;
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Azimuth in XZ: 0 = +Z, +π/2 = +X. */
export function azimuthTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function planarDist(from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz);
}

export function patrolYaw(yaw0: number, hz: number, time: number): number {
  return wrapPi(yaw0 + TAU * hz * time);
}

export function inSweepCone(watcher: Vec3, yaw: number, target: Vec3, spec: WatcherSpec): boolean {
  const dx = target.x - watcher.x;
  const dy = target.y - watcher.y;
  const dz = target.z - watcher.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-6) || dist > spec.range) return false;
  if (Math.abs(dy) > spec.height) return false;
  const az = Math.atan2(dx, dz);
  return Math.abs(wrapPi(az - yaw)) <= spec.halfCone;
}

/**
 * Radar blip in HUD space: angle 0 = +X (right), radius 0..1 of PPI.
 * `heading` is player yaw (0 = +Z).
 */
export function watcherBlip(
  watcher: Vec3,
  player: Vec3,
  heading: number,
  range = WATCHER_RADAR_RANGE,
): RadarBlip {
  const dx = watcher.x - player.x;
  const dz = watcher.z - player.z;
  const c = Math.cos(-heading);
  const s = Math.sin(-heading);
  const rx = dx * c - dz * s;
  const rz = dx * s + dz * c;
  const dist = Math.hypot(rx, rz);
  return {
    angle: Math.atan2(rz, rx),
    radius: Math.min(1, dist / Math.max(range, 1)),
    kind: 'watcher',
  };
}

export function kindForRegion(region: RegionCode, turingRoll: number): WatcherKind {
  const turingLand = region === 'EURO' || region === 'ORBT';
  if (turingLand) return turingRoll < 0.8 ? 'turing' : 'sysop';
  return turingRoll < 0.25 ? 'turing' : 'sysop';
}

/**
 * Place watchers near high-value constructs (plan §8.6). Pure; uses the
 * sector rng after traffic so construct layout is unchanged.
 */
export function placeWatchers(
  rng: Pcg32,
  constructs: readonly ConstructInstance[],
  region: RegionCode,
  density: number,
): WatcherInstance[] {
  if (region === 'VOID' || constructs.length === 0) return [];
  const valuable: ConstructInstance[] = [];
  for (const c of constructs) {
    if (c.importance >= 0.2 || c.kind === 'geodesic' || c.kind === 'nestedPoly') {
      valuable.push(c);
    }
  }
  const pool = valuable.length > 0 ? valuable : constructs;
  const turingLand = region === 'EURO' || region === 'ORBT';
  const mean = (turingLand ? 1.1 : 0.55) * Math.max(density, 0.12);
  let n = rng.poisson(mean);
  if (density > 0.45 && n === 0) n = 1;
  n = Math.min(n, 4, pool.length);
  const used = new Uint8Array(pool.length);
  const out: WatcherInstance[] = [];
  for (let i = 0; i < n; i++) {
    let idx = rng.below(pool.length);
    let guard = 0;
    while (used[idx] && guard < pool.length) {
      idx = (idx + 1) % pool.length;
      guard++;
    }
    used[idx] = 1;
    const c = pool[idx]!;
    out.push({
      x: snapToGrid(c.x + rng.float(-32, 32), MINOR_GRID),
      y: c.y + 12,
      z: snapToGrid(c.z + rng.float(-32, 32), MINOR_GRID),
      kind: kindForRegion(region, rng.next()),
      yaw0: rng.float(0, TAU),
    });
  }
  return out;
}

export interface WatcherSim {
  readonly states: readonly WatcherState[];
  readonly blips: RadarBlip[];
  readonly lures: readonly WatcherLure[];
  readonly time: number;
  readonly exposed: boolean;
  readonly traceMul: number;
  readonly lureRemaining: number;
  player: WatcherTarget;
  heading: number;
  setPlayer(x: number, y: number, z: number, heading?: number): void;
  setTime(t: number): void;
  dropLure(pos: Vec3, seconds?: number, traceMul?: number): WatcherLure;
  clearLures(): void;
  step(dt: number): void;
}

export interface WatcherSimOptions {
  watchers: readonly WatcherInstance[];
  events?: EventBus;
  trace?: TraceSink;
  player?: WatcherTarget;
  heading?: number;
}

export function createWatcherSim(opts: WatcherSimOptions): WatcherSim {
  const list = opts.watchers.slice(0, MAX_WATCHERS);
  const states: WatcherState[] = list.map((w) => ({
    x: w.x,
    y: w.y,
    z: w.z,
    kind: w.kind,
    yaw0: w.yaw0,
    yaw: w.yaw0,
    exposed: false,
    lured: false,
  }));
  const blips: RadarBlip[] = [];
  for (let i = 0; i < states.length; i++) {
    blips.push({ angle: 0, radius: 0, kind: 'watcher' });
  }
  const lurePool: WatcherLure[] = [];
  const player: WatcherTarget = {
    x: opts.player?.x ?? 0,
    y: opts.player?.y ?? 0,
    z: opts.player?.z ?? 0,
  };
  let heading = opts.heading ?? 0;
  let time = 0;
  let exposed = false;
  let traceMul = 1;
  let lureRemaining = 0;
  const wasExposed: boolean[] = states.map(() => false);

  const liveLure = (): WatcherLure | null => {
    let best: WatcherLure | null = null;
    for (const l of lurePool) {
      if (l.remaining > 0 && (!best || l.remaining > best.remaining)) best = l;
    }
    return best;
  };

  const retarget = (): void => {
    const lure = liveLure();
    lureRemaining = lure?.remaining ?? 0;
    traceMul = lure ? lure.traceMul : 1;
    let any = false;
    for (let i = 0; i < states.length; i++) {
      const w = states[i]!;
      const spec = watcherSpec(w.kind);
      w.lured = lure !== null;
      if (!w.lured) w.yaw = patrolYaw(w.yaw0, spec.hz, time);
      w.exposed = inSweepCone(w, w.yaw, player, spec);
      any = any || w.exposed;
      const b = blips[i]!;
      const next = watcherBlip(w, player, heading);
      b.angle = next.angle;
      b.radius = next.radius;
    }
    exposed = any;
  };

  retarget();

  const api: WatcherSim = {
    states,
    blips,
    get lures() {
      return lurePool;
    },
    get time() {
      return time;
    },
    get exposed() {
      return exposed;
    },
    get traceMul() {
      return traceMul;
    },
    get lureRemaining() {
      return lureRemaining;
    },
    player,
    get heading() {
      return heading;
    },
    set heading(v) {
      heading = v;
    },
    setPlayer(x, y, z, nextHeading) {
      player.x = x;
      player.y = y;
      player.z = z;
      if (nextHeading !== undefined) heading = nextHeading;
      retarget();
    },
    setTime(t) {
      time = Math.max(0, t);
      retarget();
    },
    dropLure(pos, seconds = DECOY_SECONDS, mul = DECOY_TRACE_MUL) {
      const lure: WatcherLure = {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        remaining: seconds,
        traceMul: mul,
      };
      if (lurePool.length >= MAX_LURES) lurePool.shift();
      lurePool.push(lure);
      retarget();
      return lure;
    },
    clearLures() {
      lurePool.length = 0;
      retarget();
    },
    step(dt) {
      if (!(dt > 0)) {
        retarget();
        return;
      }
      time += dt;
      for (let i = lurePool.length - 1; i >= 0; i--) {
        const l = lurePool[i]!;
        l.remaining -= dt;
        if (l.remaining <= 0) lurePool.splice(i, 1);
      }
      const lure = liveLure();
      lureRemaining = lure?.remaining ?? 0;
      traceMul = lure ? lure.traceMul : 1;
      let any = false;
      for (let i = 0; i < states.length; i++) {
        const w = states[i]!;
        const spec = watcherSpec(w.kind);
        if (lure) {
          const want = azimuthTo(w, lure);
          const delta = wrapPi(want - w.yaw);
          const max = spec.turnRate * dt;
          w.yaw = Math.abs(delta) <= max ? want : wrapPi(w.yaw + Math.sign(delta) * max);
          w.lured = true;
        } else {
          if (w.lured) w.yaw0 = wrapPi(w.yaw - TAU * spec.hz * time);
          w.lured = false;
          w.yaw = patrolYaw(w.yaw0, spec.hz, time);
        }
        w.exposed = inSweepCone(w, w.yaw, player, spec);
        any = any || w.exposed;
        if (w.exposed && !wasExposed[i]) {
          opts.events?.post({ type: 'scanPulse', origin: { x: w.x, y: w.y, z: w.z } });
        }
        wasExposed[i] = w.exposed;
        const b = blips[i]!;
        const next = watcherBlip(w, player, heading);
        b.angle = next.angle;
        b.radius = next.radius;
      }
      exposed = any;
      const rate = exposed ? WATCHER_TRACE_RATE * traceMul : 0;
      opts.trace?.step(dt, rate);
    },
  };
  return api;
}

export interface WatcherField extends WatcherSim {
  readonly object: BeamBatchGpu['object'];
  draw(): void;
  dispose(): void;
}

export interface WatcherFieldOptions extends WatcherSimOptions {
  palette: Palette;
  scene: Scene;
  /** Draw a vector probe at the tracked player (lab). */
  drawProbe?: boolean;
}

function octaEdges(
  cx: number,
  cy: number,
  cz: number,
  r: number,
  set: LineSet,
  at: number,
  beam: Beam,
  intensity: number,
): number {
  const pts: Array<[number, number, number]> = [
    [cx, cy + r, cz],
    [cx + r, cy, cz],
    [cx, cy, cz + r],
    [cx - r, cy, cz],
    [cx, cy, cz - r],
    [cx, cy - r, cz],
  ];
  const segs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [5, 1],
    [5, 2],
    [5, 3],
    [5, 4],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 1],
  ];
  for (let i = 0; i < segs.length; i++) {
    const [ia, ib] = segs[i]!;
    const A = pts[ia]!;
    const B = pts[ib]!;
    const o = (at + i) * 6;
    set.positions[o] = A[0]!;
    set.positions[o + 1] = A[1]!;
    set.positions[o + 2] = A[2]!;
    set.positions[o + 3] = B[0]!;
    set.positions[o + 4] = B[1]!;
    set.positions[o + 5] = B[2]!;
    set.color[at + i] = beam;
    set.intensity[at + i] = intensity;
    if (set.width) set.width[at + i] = 1.45;
    if (set.flags) set.flags[at + i] = BeamFlag.DWELL;
  }
  return at + segs.length;
}

function pushSeg(
  batch: BeamBatchGpu,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  c: Beam,
  i: number,
  w: number,
  f = 0,
): void {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  batch.push(_a, _b, c, i, w, f);
}

export function createWatcherField(opts: WatcherFieldOptions): WatcherField {
  const sim = createWatcherSim(opts);
  const drawProbe = opts.drawProbe ?? true;
  const fanCap =
    sim.states.length * (FAN_RAYS + FAN_ARCS * 2 + 2) +
    MAX_LURES * MARKER_EDGES +
    (drawProbe ? MARKER_EDGES : 0) +
    8;
  const batch = createBeamBatch(opts.palette, {
    capacity: Math.max(64, fanCap),
    style: { sigma: 0.7, dwell: 1.1, dwellSigma: 2.2, fogStart: 220, fogDensity: 0.0009 },
  });
  batch.object.name = 'Watchers';
  opts.scene.add(batch.object);

  const bodyCount = sim.states.length * BODY_EDGES;
  const bodies = createLineSet(Math.max(bodyCount, 1), { width: true, flags: true });
  let cursor = 0;
  for (const w of sim.states) {
    const spec = watcherSpec(w.kind);
    cursor = octaEdges(w.x, w.y, w.z, spec.body, bodies, cursor, spec.beam, 1.35);
  }
  if (cursor > 0) batch.setStatic(bodies);

  const draw = (): void => {
    batch.beginDynamic();
    for (const w of sim.states) {
      const spec = watcherSpec(w.kind);
      const hot = w.exposed ? 2.4 : w.lured ? 1.7 : 1.15;
      const half = spec.halfCone;
      for (let i = 0; i < FAN_RAYS; i++) {
        const t = i / (FAN_RAYS - 1);
        const a = w.yaw - half + t * half * 2;
        const edge = i === 0 || i === FAN_RAYS - 1;
        const spine = i === (FAN_RAYS - 1) >> 1;
        const reach = spec.range * (spine ? 1 : 0.92);
        pushSeg(
          batch,
          w.x,
          w.y,
          w.z,
          w.x + Math.sin(a) * reach,
          w.y,
          w.z + Math.cos(a) * reach,
          spec.beam,
          spine ? hot * 1.35 : edge ? hot * 0.85 : hot * 0.55,
          spine ? 2.1 : edge ? 1.55 : 1.15,
          spine ? BeamFlag.DWELL : 0,
        );
      }
      for (let ring = 0; ring < 2; ring++) {
        const rr = spec.range * (ring === 0 ? 0.55 : 1);
        const glow = hot * (ring === 1 ? 0.7 : 0.4);
        for (let i = 0; i < FAN_ARCS; i++) {
          const t0 = i / FAN_ARCS;
          const t1 = (i + 1) / FAN_ARCS;
          const a0 = w.yaw - half + t0 * half * 2;
          const a1 = w.yaw - half + t1 * half * 2;
          pushSeg(
            batch,
            w.x + Math.sin(a0) * rr,
            w.y,
            w.z + Math.cos(a0) * rr,
            w.x + Math.sin(a1) * rr,
            w.y,
            w.z + Math.cos(a1) * rr,
            spec.beam,
            glow,
            1.2,
          );
        }
      }
    }
    for (const lure of sim.lures) {
      if (lure.remaining <= 0) continue;
      const s = 2.6;
      pushSeg(
        batch,
        lure.x - s,
        lure.y,
        lure.z,
        lure.x + s,
        lure.y,
        lure.z,
        Beam.ICE,
        2.2,
        1.8,
        BeamFlag.DWELL,
      );
      pushSeg(
        batch,
        lure.x,
        lure.y - s,
        lure.z,
        lure.x,
        lure.y + s,
        lure.z,
        Beam.ICE,
        2.2,
        1.8,
        BeamFlag.DWELL,
      );
      pushSeg(
        batch,
        lure.x,
        lure.y,
        lure.z - s,
        lure.x,
        lure.y,
        lure.z + s,
        Beam.ICE,
        2.2,
        1.8,
        BeamFlag.DWELL,
      );
    }
    if (drawProbe) {
      const p = sim.player;
      const s = 2.1;
      pushSeg(batch, p.x - s, p.y, p.z, p.x + s, p.y, p.z, Beam.GRID, 1.8, 1.7, BeamFlag.DWELL);
      pushSeg(batch, p.x, p.y - s, p.z, p.x, p.y + s, p.z, Beam.GRID, 1.8, 1.7, BeamFlag.DWELL);
      pushSeg(batch, p.x, p.y, p.z - s, p.x, p.y, p.z + s, Beam.GRID, 1.8, 1.7, BeamFlag.DWELL);
    }
    batch.endDynamic();
  };

  draw();

  return {
    get states() {
      return sim.states;
    },
    get blips() {
      return sim.blips;
    },
    get lures() {
      return sim.lures;
    },
    get time() {
      return sim.time;
    },
    get exposed() {
      return sim.exposed;
    },
    get traceMul() {
      return sim.traceMul;
    },
    get lureRemaining() {
      return sim.lureRemaining;
    },
    get player() {
      return sim.player;
    },
    get heading() {
      return sim.heading;
    },
    set heading(v) {
      sim.heading = v;
    },
    object: batch.object,
    setPlayer(x, y, z, heading) {
      sim.setPlayer(x, y, z, heading);
      draw();
    },
    setTime(t) {
      sim.setTime(t);
      draw();
    },
    dropLure(pos, seconds, mul) {
      const lure = sim.dropLure(pos, seconds, mul);
      draw();
      return lure;
    },
    clearLures() {
      sim.clearLures();
      draw();
    },
    step(dt) {
      sim.step(dt);
      draw();
    },
    draw,
    dispose() {
      opts.scene.remove(batch.object);
      batch.dispose();
    },
  };
}
