/**
 * Core interior (M4.5): a seeded vertical cathedral of hatched strata,
 * record lightpoints, and on-beat target / off-beat decoy constellations.
 * Download is a hold; exfil is jack-out vs route-out with re-freezing ICE
 * layers. Does not rewrite BreachController or IceVisuals.
 */

import { DEFAULT_BPM, beatDuration, pulse } from '../audio/music/Sequencer';
import type { EventBus } from '../core/events';
import type { Vec3 } from '../core/math/vec3';
import { pcg32, type Pcg32 } from '../core/rng';
import { createHeat, type Heat } from '../deck/Heat';
import { createTrace, ROUTE_OUT_TRACE_SCRUB, TRACE_MAX, type Trace } from '../deck/Trace';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  lineSetCount,
  type BeamBatchGpu,
  type LineSet,
} from '../render/lines/BeamBatch';
import {
  createPointBatch,
  createPointSet,
  type GpuPointBatch,
  type PointSet,
} from '../render/points/PointBatch';
import type { Renderer } from '../render/Renderer';
import { generate } from '../world/constructs/grammar';

/** Plan §8.6: 6–12 translucent strata planes. */
export const CORE_STRATA_MIN = 6;
export const CORE_STRATA_MAX = 12;
/** Plan §12.3: core interior ×1.5 vs the idle core rate. */
export const CORE_TRACE_RATE = 0.4;
export const CORE_TRACE_MUL = 1.5;
/** Hold Download (`E`) duration to finish the take (plan §3.2 / §3.9). */
export const DOWNLOAD_HOLD_S = 3;
/** World-unit radius around the target constellation centroid. */
export const DOWNLOAD_RADIUS = 14;
/** Plan §3.2: route-out flight while layers re-freeze. */
export const ROUTE_OUT_MIN_S = 20;
export const ROUTE_OUT_MAX_S = 40;
export const DEFAULT_REFREEZE_S = 30;
/** Plan §3.9 jack-out hold. Local copy so this module does not import BreachController. */
export const CORE_JACK_OUT_HOLD = 1;
export { ROUTE_OUT_TRACE_SCRUB };
export const CORE_BPM = DEFAULT_BPM;
export const DEFAULT_DECOYS = 3;
export const DEFAULT_ICE_LAYERS = 4;
export const TARGET_POINTS = 18;
export const DECOY_POINTS = 12;
export const RECORD_GRID = 4;

export type CorePhase = 'hunt' | 'download' | 'exfil' | 'routeOut' | 'jackOut' | 'done';

export type CoreOutcome =
  | { kind: 'none' }
  | { kind: 'downloaded'; targetId: string }
  | { kind: 'jackOut' }
  | { kind: 'routeOut' }
  | { kind: 'routeDone' }
  | { kind: 'burned' };

export interface CoreDef {
  seed: number;
  /** Clamped to 6–12. Omitted → rng. */
  strata?: number;
  targetRecord: string;
  decoys?: number;
  bpm?: number;
  downloadHold?: number;
  /** Seconds for cracked layers to re-freeze (also the route-out duration). */
  refreeze?: number;
  /** Cracked ICE layer count that re-freezes on the way out. */
  layers?: number;
}

export interface CoreRecord {
  x: number;
  y: number;
  z: number;
  code: string;
  stratum: number;
}

export interface CoreConstellation {
  id: string;
  kind: 'target' | 'decoy';
  code: string;
  stratum: number;
  cx: number;
  cy: number;
  cz: number;
  points: Float32Array;
}

export interface CoreStratum {
  index: number;
  y: number;
  width: number;
  depth: number;
  records: CoreRecord[];
}

export interface CoreLayout {
  seed: number;
  strataCount: number;
  strata: CoreStratum[];
  target: CoreConstellation;
  decoys: CoreConstellation[];
  records: CoreRecord[];
  width: number;
  depth: number;
  minY: number;
  maxY: number;
}

export interface CoreStepInput {
  downloadHeld: boolean;
  player?: Vec3;
  jackHeld?: number;
  engagePressed?: boolean;
}

export interface CoreInterior {
  readonly def: CoreDef;
  readonly layout: CoreLayout;
  readonly time: number;
  readonly phase: CorePhase;
  readonly download: number;
  readonly downloaded: boolean;
  readonly freezeProgress: number;
  readonly frozenLayers: number;
  readonly layerCount: number;
  readonly routeElapsed: number;
  readonly refreezeDuration: number;
  readonly nearTarget: boolean;
  readonly targetPulse: number;
  readonly decoyPulse: number;
  readonly trace: Trace;
  readonly heat: Heat;
  readonly lastOutcome: CoreOutcome;
  distanceToTarget(player: Vec3): number;
  isNearTarget(player: Vec3): boolean;
  layerFreeze(index: number): number;
  setTime(t: number): void;
  step(dt: number, input: CoreStepInput): CoreOutcome;
  completeDownload(): void;
  startRouteOut(): boolean;
  startJackOut(): boolean;
  attach(renderer: Renderer): void;
  updateVisuals(dt: number): void;
  paint(): void;
  dispose(): void;
}

export interface CoreInteriorOptions {
  events?: EventBus;
  trace?: Trace;
  heat?: Heat;
  def: CoreDef;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}

function hypot3(dx: number, dy: number, dz: number): number {
  return Math.hypot(dx, dy, dz);
}

/** On-beat (target) or off-beat (decoy) raised-cosine envelope in [0, 1]. */
export function constellationPulse(t: number, bpm = CORE_BPM, offBeat = false): number {
  const shift = offBeat ? beatDuration(bpm) * 0.5 : 0;
  return pulse(t + shift, bpm);
}

export function layerFreeze(
  elapsed: number,
  duration: number,
  index: number,
  count: number,
): number {
  if (count <= 0 || duration <= 0) return elapsed > 0 ? 1 : 0;
  const span = duration / count;
  return clamp((elapsed - index * span) / span, 0, 1);
}

function catalogCode(rng: Pcg32, prefix = 'REC'): string {
  return `${prefix}-${String(rng.below(10_000)).padStart(4, '0')}`;
}

function translatePoints(src: Float32Array, dx: number, dy: number, dz: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i]! + dx;
    out[i + 1] = src[i + 1]! + dy;
    out[i + 2] = src[i + 2]! + dz;
  }
  return out;
}

function centroid(points: Float32Array): { x: number; y: number; z: number } {
  const n = points.length / 3;
  if (n <= 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 3) {
    x += points[i]!;
    y += points[i + 1]!;
    z += points[i + 2]!;
  }
  return { x: x / n, y: y / n, z: z / n };
}

function concatLineSets(sets: LineSet[]): LineSet {
  let n = 0;
  for (const s of sets) n += lineSetCount(s);
  const out = createLineSet(n, { width: true, flags: true });
  let w = 0;
  for (const s of sets) {
    const c = lineSetCount(s);
    out.positions.set(s.positions.subarray(0, c * 6), w * 6);
    out.color.set(s.color.subarray(0, c), w);
    out.intensity.set(s.intensity.subarray(0, c), w);
    if (out.width) {
      if (s.width) out.width.set(s.width.subarray(0, c), w);
      else out.width.fill(1.5, w, w + c);
    }
    if (out.flags) {
      if (s.flags) out.flags.set(s.flags.subarray(0, c), w);
      else out.flags.fill(0, w, w + c);
    }
    w += c;
  }
  return out;
}

function pushSeg(
  segs: number[],
  colors: number[],
  intens: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  color: number,
  intensity: number,
): void {
  segs.push(ax, ay, az, bx, by, bz);
  colors.push(color);
  intens.push(intensity);
}

function segsToLineSet(
  segs: number[],
  colors: number[],
  intens: number[],
  width = 1.4,
  flags = 0,
): LineSet {
  const n = colors.length;
  const set = createLineSet(n, { width: true, flags: true });
  set.positions.set(segs);
  for (let i = 0; i < n; i++) {
    set.color[i] = colors[i]!;
    set.intensity[i] = intens[i]!;
    set.width![i] = width;
    set.flags![i] = flags;
  }
  return set;
}

function cubeOutline(r: number, color: Beam, intensity: number): LineSet {
  const s: number[] = [];
  const c: number[] = [];
  const inten: number[] = [];
  const p: Array<[number, number, number]> = [
    [-r, -r, -r],
    [r, -r, -r],
    [r, r, -r],
    [-r, r, -r],
    [-r, -r, r],
    [r, -r, r],
    [r, r, r],
    [-r, r, r],
  ];
  const edges: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [a, b] of edges) {
    const A = p[a]!;
    const B = p[b]!;
    pushSeg(s, c, inten, A[0], A[1], A[2], B[0], B[1], B[2], color, intensity);
  }
  // Two hatches on the "front" face — 1984 vector, not a filled shell.
  pushSeg(s, c, inten, -r, -r, r, r, r, r, color, intensity * 0.45);
  pushSeg(s, c, inten, r, -r, r, -r, r, r, color, intensity * 0.45);
  return segsToLineSet(s, c, inten, 1.7, BeamFlag.DWELL);
}

function makeConstellation(
  rng: Pcg32,
  n: number,
  ox: number,
  oy: number,
  oz: number,
  kind: 'target' | 'decoy',
  code: string,
  stratum: number,
  id: string,
): CoreConstellation {
  const geom = generate(
    { kind: 'constellation', n, distribution: 'cluster' },
    { rng, color: kind === 'target' ? Beam.AMBER : Beam.ICE, intensity: 1 },
  );
  const points = translatePoints(geom.points.positions, ox, oy, oz);
  const c = centroid(points);
  return { id, kind, code, stratum, cx: c.x, cy: c.y, cz: c.z, points };
}

/**
 * Pure core layout. Same seed (and the same optional strata / record) always
 * yields the same planes, records and constellations.
 */
export function generateCore(def: CoreDef): CoreLayout {
  const seed = def.seed | 0;
  const layoutRng = pcg32(seed, 0xc0e1);
  const n = clampInt(
    def.strata ?? layoutRng.int(CORE_STRATA_MIN, CORE_STRATA_MAX),
    CORE_STRATA_MIN,
    CORE_STRATA_MAX,
  );
  const width = layoutRng.float(24, 32);
  const depth = layoutRng.float(20, 28);
  const spacing = layoutRng.float(7.5, 9.5);
  const decoyN = Math.max(1, def.decoys ?? DEFAULT_DECOYS);
  const targetStratum = layoutRng.int(Math.max(1, Math.floor(n * 0.4)), n - 2);
  const used = new Set<number>([targetStratum]);
  const decoyStrata: number[] = [];
  while (decoyStrata.length < decoyN && used.size < n) {
    const s = layoutRng.int(0, n - 1);
    if (used.has(s)) continue;
    used.add(s);
    decoyStrata.push(s);
  }
  while (decoyStrata.length < decoyN) decoyStrata.push(targetStratum);

  const strata: CoreStratum[] = [];
  const records: CoreRecord[] = [];
  const grid = RECORD_GRID;
  for (let i = 0; i < n; i++) {
    const y = 4 + i * spacing;
    const row: CoreRecord[] = [];
    for (let gz = 0; gz < grid; gz++) {
      for (let gx = 0; gx < grid; gx++) {
        const x = -width * 0.4 + (gx / (grid - 1)) * width * 0.8;
        const z = -depth * 0.4 + (gz / (grid - 1)) * depth * 0.8;
        const jitter = 0.35;
        const rec: CoreRecord = {
          x: x + layoutRng.float(-jitter, jitter),
          y: y + layoutRng.float(-0.15, 0.15),
          z: z + layoutRng.float(-jitter, jitter),
          code: catalogCode(layoutRng),
          stratum: i,
        };
        row.push(rec);
        records.push(rec);
      }
    }
    strata.push({ index: i, y, width, depth, records: row });
  }

  const targetCode = def.targetRecord;
  const tStr = strata[targetStratum]!;
  const tOffX = layoutRng.float(-width * 0.22, width * 0.22);
  const tOffZ = layoutRng.float(-depth * 0.18, depth * 0.05);
  const target = makeConstellation(
    pcg32(seed, 0xc0e2),
    TARGET_POINTS,
    tOffX,
    tStr.y + 1.6,
    tOffZ,
    'target',
    targetCode,
    targetStratum,
    targetCode,
  );
  if (tStr.records[0]) tStr.records[0].code = targetCode;

  const decoys: CoreConstellation[] = [];
  for (let i = 0; i < decoyN; i++) {
    const si = decoyStrata[i]!;
    const st = strata[si]!;
    const code = catalogCode(pcg32(seed, 0xde00 + i), 'DEC');
    decoys.push(
      makeConstellation(
        pcg32(seed, 0xde10 + i),
        DECOY_POINTS,
        layoutRng.float(-width * 0.28, width * 0.28),
        st.y + 1.4,
        layoutRng.float(-depth * 0.22, depth * 0.22),
        'decoy',
        code,
        si,
        `decoy-${i}`,
      ),
    );
  }

  return {
    seed,
    strataCount: n,
    strata,
    target,
    decoys,
    records,
    width,
    depth,
    minY: strata[0]!.y,
    maxY: strata[n - 1]!.y,
  };
}

function hatchedPlane(y: number, width: number, depth: number, intensity: number): LineSet {
  const segs: number[] = [];
  const colors: number[] = [];
  const intens: number[] = [];
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const x0 = -hw;
  const x1 = hw;
  const z0 = -hd;
  const z1 = hd;
  pushSeg(segs, colors, intens, x0, y, z0, x1, y, z0, Beam.GRID, intensity);
  pushSeg(segs, colors, intens, x1, y, z0, x1, y, z1, Beam.GRID, intensity);
  pushSeg(segs, colors, intens, x1, y, z1, x0, y, z1, Beam.GRID, intensity);
  pushSeg(segs, colors, intens, x0, y, z1, x0, y, z0, Beam.GRID, intensity);
  const mx = (x0 + x1) * 0.5;
  const mz = (z0 + z1) * 0.5;
  pushSeg(segs, colors, intens, mx, y, z0, mx, y, z1, Beam.GRID, intensity * 0.4);
  pushSeg(segs, colors, intens, x0, y, mz, x1, y, mz, Beam.GRID, intensity * 0.4);
  pushSeg(segs, colors, intens, x0, y, z0, x1, y, z1, Beam.GRID, intensity * 0.28);
  return segsToLineSet(segs, colors, intens, 1.15);
}

function buildStrataLines(layout: CoreLayout): LineSet {
  const sets: LineSet[] = [];
  for (const s of layout.strata) {
    sets.push(hatchedPlane(s.y, s.width, s.depth, 0.32));
  }
  const nave: number[] = [];
  const ncol: number[] = [];
  const nint: number[] = [];
  const hw = layout.width * 0.5;
  const hd = layout.depth * 0.5;
  const y0 = layout.minY;
  const y1 = layout.maxY;
  const corners: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  for (const [x, z] of corners) {
    pushSeg(nave, ncol, nint, x, y0, z, x, y1, z, Beam.AFTERGLOW, 0.42);
  }
  sets.push(segsToLineSet(nave, ncol, nint, 1.35));
  return concatLineSets(sets);
}

function buildRecordPoints(layout: CoreLayout): PointSet {
  const n = layout.records.length;
  const set = createPointSet(n, { size: true });
  for (let i = 0; i < n; i++) {
    const r = layout.records[i]!;
    set.positions[i * 3] = r.x;
    set.positions[i * 3 + 1] = r.y;
    set.positions[i * 3 + 2] = r.z;
    set.color[i] = Beam.AFTERGLOW;
    set.intensity[i] = 0.22;
    set.size![i] = 1.35;
  }
  return set;
}

/**
 * Core sim + optional GPU attach. Generation is a pure function of `def.seed`.
 */
export function createCoreInterior(opts: CoreInteriorOptions): CoreInterior {
  const def: CoreDef = {
    ...opts.def,
    strata: opts.def.strata,
    decoys: opts.def.decoys ?? DEFAULT_DECOYS,
    bpm: opts.def.bpm ?? CORE_BPM,
    downloadHold: opts.def.downloadHold ?? DOWNLOAD_HOLD_S,
    refreeze: clamp(opts.def.refreeze ?? DEFAULT_REFREEZE_S, ROUTE_OUT_MIN_S, ROUTE_OUT_MAX_S),
    layers: Math.max(1, opts.def.layers ?? DEFAULT_ICE_LAYERS),
  };
  const layout = generateCore(def);
  const events = opts.events;
  const trace = opts.trace ?? createTrace({ events });
  const heat = opts.heat ?? createHeat();
  const bpm = def.bpm!;
  const holdS = def.downloadHold!;
  const refreezeDuration = def.refreeze!;
  const layerCount = def.layers!;
  const targetId = def.targetRecord;

  let time = 0;
  let phase: CorePhase = 'hunt';
  let download = 0;
  let postedPct = -1;
  let freezeElapsed = 0;
  let nearTarget = false;
  let lastOutcome: CoreOutcome = { kind: 'none' };
  let jackPosted = false;

  let strataBatch: BeamBatchGpu | null = null;
  let iceBatch: BeamBatchGpu | null = null;
  let recordsBatch: GpuPointBatch | null = null;
  let starsBatch: GpuPointBatch | null = null;
  let attached: Renderer | null = null;
  const iceCubes: LineSet[] = [];
  for (let i = 0; i < layerCount; i++) {
    iceCubes.push(cubeOutline(10 + i * 7, Beam.ICE, 1));
  }

  const emitProgress = (value: number): void => {
    const v = clamp(value, 0, 1);
    const pct = Math.round(v * 100);
    if (pct === postedPct) return;
    postedPct = pct;
    events?.post({ type: 'downloadProgress', targetId, value: v });
  };

  const setDownload = (value: number): void => {
    download = clamp(value, 0, 1);
    emitProgress(download);
  };

  const pulseNow = (off: boolean): number => constellationPulse(time, bpm, off);

  const syncViewport = (): void => {
    if (!attached) return;
    const w = attached.internalWidth;
    const h = attached.internalHeight;
    recordsBatch?.setViewport(w, h);
    starsBatch?.setViewport(w, h);
  };

  const distTo = (player: Vec3): number =>
    hypot3(player.x - layout.target.cx, player.y - layout.target.cy, player.z - layout.target.cz);

  const paintStars = (): void => {
    if (!starsBatch) return;
    const on = 0.28 + 0.55 * pulseNow(false);
    const off = 0.12 + 0.32 * pulseNow(true);
    starsBatch.beginDynamic();
    const tp = layout.target.points;
    for (let i = 0; i < tp.length; i += 3) {
      starsBatch.push({ x: tp[i]!, y: tp[i + 1]!, z: tp[i + 2]! }, Beam.AMBER, on, 2.6);
    }
    for (const d of layout.decoys) {
      const p = d.points;
      for (let i = 0; i < p.length; i += 3) {
        starsBatch.push({ x: p[i]!, y: p[i + 1]!, z: p[i + 2]! }, Beam.ICE, off, 1.8);
      }
    }
    starsBatch.endDynamic();
  };

  const paintIce = (): void => {
    if (!iceBatch) return;
    iceBatch.beginDynamic();
    if (phase === 'routeOut' || phase === 'done') {
      const a = { x: 0, y: 0, z: 0 };
      const b = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < layerCount; i++) {
        const t = layerFreeze(freezeElapsed, refreezeDuration, i, layerCount);
        if (t <= 0.01) continue;
        const set = iceCubes[i]!;
        const n = lineSetCount(set);
        const fade = 0.35 + 1.4 * t;
        for (let s = 0; s < n; s++) {
          const o = s * 6;
          a.x = set.positions[o]!;
          a.y = set.positions[o + 1]!;
          a.z = set.positions[o + 2]!;
          b.x = set.positions[o + 3]!;
          b.y = set.positions[o + 4]!;
          b.z = set.positions[o + 5]!;
          iceBatch.push(a, b, Beam.ICE, fade * (set.intensity[s] ?? 1), 1.8, BeamFlag.DWELL);
        }
      }
    }
    iceBatch.endDynamic();
  };

  const finishJack = (): CoreOutcome => {
    if (phase === 'jackOut' || phase === 'done') return lastOutcome;
    phase = 'jackOut';
    heat.applyRunEnd(trace.value, false);
    if (!jackPosted) {
      jackPosted = true;
      events?.post({ type: 'jackOut', reason: 'player' });
    }
    const out: CoreOutcome = { kind: 'jackOut' };
    lastOutcome = out;
    paintStars();
    paintIce();
    return out;
  };

  const finishBurned = (): CoreOutcome => {
    phase = 'done';
    heat.applyRunEnd(trace.value, true);
    events?.post({ type: 'jackOut', reason: 'burned' });
    const out: CoreOutcome = { kind: 'burned' };
    lastOutcome = out;
    paintStars();
    paintIce();
    return out;
  };

  const beginRoute = (): boolean => {
    if (!api.downloaded || phase === 'routeOut' || phase === 'done' || phase === 'jackOut') {
      return false;
    }
    phase = 'routeOut';
    freezeElapsed = 0;
    trace.scrub(ROUTE_OUT_TRACE_SCRUB);
    lastOutcome = { kind: 'routeOut' };
    return true;
  };

  const api: CoreInterior = {
    def,
    layout,
    get time() {
      return time;
    },
    get phase() {
      return phase;
    },
    get download() {
      return download;
    },
    get downloaded() {
      return (
        download >= 1 ||
        phase === 'exfil' ||
        phase === 'routeOut' ||
        phase === 'jackOut' ||
        phase === 'done'
      );
    },
    get freezeProgress() {
      return clamp(freezeElapsed / refreezeDuration, 0, 1);
    },
    get frozenLayers() {
      let n = 0;
      for (let i = 0; i < layerCount; i++)
        if (layerFreeze(freezeElapsed, refreezeDuration, i, layerCount) >= 1) n++;
      return n;
    },
    get layerCount() {
      return layerCount;
    },
    get routeElapsed() {
      return freezeElapsed;
    },
    get refreezeDuration() {
      return refreezeDuration;
    },
    get nearTarget() {
      return nearTarget;
    },
    get targetPulse() {
      return pulseNow(false);
    },
    get decoyPulse() {
      return pulseNow(true);
    },
    trace,
    heat,
    get lastOutcome() {
      return lastOutcome;
    },
    distanceToTarget(player) {
      return distTo(player);
    },
    isNearTarget(player) {
      return distTo(player) <= DOWNLOAD_RADIUS;
    },
    layerFreeze(index) {
      return layerFreeze(freezeElapsed, refreezeDuration, index, layerCount);
    },
    setTime(t) {
      time = Math.max(0, t);
      paintStars();
    },
    step(dt, input) {
      lastOutcome = { kind: 'none' };
      if (!(dt > 0)) {
        if (input.player) nearTarget = distTo(input.player) <= DOWNLOAD_RADIUS;
        return lastOutcome;
      }
      time += dt;
      if (input.player) nearTarget = distTo(input.player) <= DOWNLOAD_RADIUS;
      else nearTarget = input.downloadHeld && phase !== 'exfil';

      if (phase === 'hunt' || phase === 'download') {
        trace.step(dt, CORE_TRACE_RATE * CORE_TRACE_MUL);
        if (trace.value >= TRACE_MAX) return finishBurned();
        const canHold = input.downloadHeld && nearTarget && !api.downloaded;
        if (canHold) {
          if (phase === 'hunt') phase = 'download';
          const next = download + dt / holdS;
          if (next >= 1) {
            setDownload(1);
            phase = 'exfil';
            lastOutcome = { kind: 'downloaded', targetId };
            paintStars();
            paintIce();
            return lastOutcome;
          }
          setDownload(next);
        } else if (phase === 'download') {
          setDownload(0);
          phase = 'hunt';
        }
      } else if (phase === 'exfil') {
        trace.step(dt, CORE_TRACE_RATE * CORE_TRACE_MUL);
        if (trace.value >= TRACE_MAX) return finishBurned();
        if (input.engagePressed) {
          beginRoute();
          return lastOutcome;
        }
        if ((input.jackHeld ?? 0) >= CORE_JACK_OUT_HOLD) return finishJack();
      } else if (phase === 'routeOut') {
        freezeElapsed += dt;
        if (freezeElapsed >= refreezeDuration) {
          phase = 'done';
          lastOutcome = { kind: 'routeDone' };
        }
      }

      paintStars();
      paintIce();
      return lastOutcome;
    },
    completeDownload() {
      if (api.downloaded) return;
      setDownload(1);
      phase = 'exfil';
      lastOutcome = { kind: 'downloaded', targetId };
    },
    startRouteOut() {
      return beginRoute();
    },
    startJackOut() {
      if (!api.downloaded) return false;
      finishJack();
      return true;
    },
    attach(renderer) {
      api.dispose();
      attached = renderer;
      const strata = buildStrataLines(layout);
      strataBatch = createBeamBatch(renderer.palette, {
        capacity: Math.max(lineSetCount(strata), 8),
      });
      strataBatch.setStatic(strata);
      renderer.scenes.matrix.add(strataBatch.object);

      const rec = buildRecordPoints(layout);
      recordsBatch = createPointBatch({
        capacity: Math.max(rec.color.length, 8),
        palette: renderer.palette,
      });
      recordsBatch.setStatic(rec);
      renderer.scenes.matrix.add(recordsBatch.object);

      let starN = layout.target.points.length / 3;
      for (const d of layout.decoys) starN += d.points.length / 3;
      starsBatch = createPointBatch({
        capacity: Math.max(starN, 8),
        palette: renderer.palette,
      });
      renderer.scenes.matrix.add(starsBatch.object);

      let iceN = 0;
      for (const c of iceCubes) iceN += lineSetCount(c);
      iceBatch = createBeamBatch(renderer.palette, { capacity: Math.max(iceN, 16) });
      renderer.scenes.matrix.add(iceBatch.object);

      paintStars();
      paintIce();
      syncViewport();
    },
    updateVisuals(dt) {
      if (dt > 0 && attached) {
        /* intensities already follow `time` via paintStars */
      }
      paintStars();
      paintIce();
      syncViewport();
    },
    paint() {
      paintStars();
      paintIce();
      syncViewport();
    },
    dispose() {
      const scene = attached?.scenes.matrix;
      if (strataBatch) {
        scene?.remove(strataBatch.object);
        strataBatch.dispose();
      }
      if (iceBatch) {
        scene?.remove(iceBatch.object);
        iceBatch.dispose();
      }
      if (recordsBatch) {
        scene?.remove(recordsBatch.object);
        recordsBatch.dispose();
      }
      if (starsBatch) {
        scene?.remove(starsBatch.object);
        starsBatch.dispose();
      }
      strataBatch = null;
      iceBatch = null;
      recordsBatch = null;
      starsBatch = null;
      attached = null;
    },
  };
  return api;
}
