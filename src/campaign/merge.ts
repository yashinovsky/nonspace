import type { Persona } from '../ai/Persona';
import type { Palette } from '../render/palette';
import type { GroundGrid, WarpPoint } from '../render/grid/GroundGrid';

/** Five scripted minutes (plan §4.4). E2E seeks; live play runs the clock. */
export const MERGE_DURATION = 300;

export type MergePhase = 'break' | 'fold' | 'reflow' | 'unify' | 'done';

export interface MergeSample {
  phase: MergePhase;
  /** 0..1 through the whole sequence. */
  u: number;
  breakT: number;
  fold: number;
  reflow: number;
  unify: number;
  lerpWhite: number;
  warmth: number;
  warp: WarpPoint[];
  /** 0 = two AI portraits, 1 = one. */
  personaMix: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function mergePhaseAt(t: number): MergePhase {
  if (t >= MERGE_DURATION) return 'done';
  if (t < 48) return 'break';
  if (t < 110) return 'fold';
  if (t < 200) return 'reflow';
  return 'unify';
}

function mergeWarp(t: number, reflow: number): WarpPoint[] {
  const ang = t * 0.07;
  const str = (0.35 + reflow * 1.1) * Math.sin(t * 0.09 + 0.4);
  const r = 140 + reflow * 80;
  const pull = reflow > 0.65 ? -(reflow - 0.65) * 2.4 : str;
  return [
    { x: Math.cos(ang) * 80, z: Math.sin(ang) * 80, radius: r, strength: pull },
    {
      x: Math.cos(ang + 1.6) * 90,
      z: Math.sin(ang + 1.6) * 90,
      radius: r * 0.85,
      strength: -pull * 0.7,
    },
    {
      x: Math.cos(ang + 3.1) * 70,
      z: Math.sin(ang + 3.1) * 70,
      radius: r * 1.1,
      strength: pull * 0.55,
    },
    {
      x: Math.cos(ang + 4.7) * 100,
      z: Math.sin(ang + 4.7) * 100,
      radius: r,
      strength: -pull * 0.4,
    },
  ];
}

/**
 * Palette-break / fold / grid reflow / unify. Look Lab stays the matrix lock;
 * this is the planned rule-break (plan §2.1 #5, §4.4 merge).
 */
export function mergeSample(t: number, reduceFlashing = false): MergeSample {
  const u = clamp01(t / MERGE_DURATION);
  const flash = reduceFlashing ? 0.32 : 1;
  const breakT = clamp01(t / 48);
  const fold = clamp01((t - 40) / 70);
  const reflow = clamp01((t - 100) / 90);
  const unify = clamp01((t - 190) / 110);
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.13);
  const lerpWhite = breakT * (1 - unify * 0.75) * pulse * flash;
  const warmth = (0.15 + unify * 0.85) * flash;
  return {
    phase: mergePhaseAt(t),
    u,
    breakT,
    fold,
    reflow,
    unify,
    lerpWhite,
    warmth,
    warp: mergeWarp(t, reflow),
    personaMix: unify,
  };
}

export interface MergeHost {
  palette: Palette;
  grid: GroundGrid;
  fold: (amount: number) => void;
  wintermute: Persona;
  neuromancer: Persona;
  reduceFlashing: () => boolean;
  /** Cluster world position — portraits orbit then meet here. */
  origin: { x: number; y: number; z: number };
}

export interface MergeFx {
  readonly t: number;
  readonly sample: MergeSample;
  readonly running: boolean;
  start(): void;
  seek(t: number): void;
  update(dt: number): void;
  apply(): void;
  reset(): void;
  dispose(): void;
}

export function createMergeFx(host: MergeHost): MergeFx {
  let t = 0;
  let running = false;
  let sample = mergeSample(0);

  const placePersonas = (s: MergeSample): void => {
    const o = host.origin;
    const spread = 28 * (1 - s.personaMix);
    host.wintermute.setWho('finn', true);
    host.neuromancer.setWho('linda', s.personaMix < 0.97);
    host.wintermute.setPose(o.x - spread, o.y + 10, o.z + 22, 10 + s.unify * 4);
    host.neuromancer.setPose(o.x + spread, o.y + 8, o.z + 22, 9 + s.unify * 3);
    host.wintermute.update(t);
    host.neuromancer.update(t * 1.07);
  };

  const apply = (): void => {
    sample = mergeSample(t, host.reduceFlashing());
    host.palette.lerpAllTo({ r: 1, g: 0.95, b: 0.82 }, sample.lerpWhite);
    host.palette.addWarmth(sample.warmth);
    host.grid.setWarp(sample.warp);
    host.fold(sample.fold);
    placePersonas(sample);
  };

  const api: MergeFx = {
    get t() {
      return t;
    },
    get sample() {
      return sample;
    },
    get running() {
      return running;
    },
    start() {
      running = true;
      t = 0;
      apply();
    },
    seek(next) {
      t = Math.max(0, next);
      running = t < MERGE_DURATION;
      apply();
    },
    update(dt) {
      if (!running) return;
      t += Math.max(0, dt);
      if (t >= MERGE_DURATION) {
        t = MERGE_DURATION;
        running = false;
      }
      apply();
    },
    apply,
    reset() {
      running = false;
      t = 0;
      sample = mergeSample(0);
      host.palette.reset();
      host.grid.setWarp([]);
      host.fold(0);
      host.wintermute.setWho(null);
      host.neuromancer.setWho(null);
    },
    dispose() {
      api.reset();
      host.wintermute.dispose();
      host.neuromancer.dispose();
    },
  };
  return api;
}
