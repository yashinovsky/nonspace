import type { SimstimTimeline } from '../content/simstim/types';
import type { Vec3 } from '../core/math/vec3';
import { chipClockAt } from './clock';

export interface CameraSample {
  pos: Vec3;
  look: Vec3;
  bob: number;
}

export interface FigureSample {
  id: string;
  rig: string;
  pose: string;
  pos: Vec3;
  yaw: number;
}

export interface SpokenLine {
  t: number;
  who: string;
  text: string;
}

export interface TimelineSample {
  camera: CameraSample;
  figures: FigureSample[];
  line: SpokenLine | null;
  clock: string;
  playbackTime: number;
  waiting: boolean;
}

export interface MollyTimeline {
  readonly def: SimstimTimeline | null;
  /** Meat-time playback cursor; freezes during a wait. */
  readonly playbackTime: number;
  readonly waiting: boolean;
  load(def: SimstimTimeline): void;
  reset(): void;
  /**
   * Advance. `meatTime` is the unpaused clock; `waitPlayback` is the gate's
   * hold time (or null). Lines fire once as playback crosses their `t`.
   */
  update(dt: number, meatTime: number, waitPlayback: number | null): void;
  sample(out?: TimelineSample): TimelineSample;
  /** Lines whose `t` was crossed this step (at most a handful). */
  readonly firedLines: readonly SpokenLine[];
}

const WALK_HZ = 1.7;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

function seg<T extends { t: number }>(keys: T[], t: number): { a: T; b: T; u: number } {
  if (keys.length === 0) throw new Error('empty keyframe list');
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, u: 0 };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { a: last, b: last, u: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      return { a, b, u: span > 1e-8 ? (t - a.t) / span : 0 };
    }
  }
  return { a: last, b: last, u: 0 };
}

export function sampleCameraPath(
  path: SimstimTimeline['cameraPath'],
  t: number,
  out: CameraSample,
): CameraSample {
  if (path.length === 0) {
    out.pos.x = 0;
    out.pos.y = 1.6;
    out.pos.z = 0;
    out.look.x = 0;
    out.look.y = 1.6;
    out.look.z = -1;
    out.bob = 0;
    return out;
  }
  const { a, b, u } = seg(path, t);
  lerpVec(a.pos, b.pos, u, out.pos);
  lerpVec(a.look, b.look, u, out.look);
  out.bob = lerp(a.bob ?? 0.02, b.bob ?? a.bob ?? 0.02, u);
  const walk = Math.sin(t * Math.PI * 2 * WALK_HZ);
  out.pos.y += walk * out.bob;
  out.pos.x += Math.cos(t * Math.PI * 2 * WALK_HZ) * out.bob * 0.25;
  return out;
}

export function createMollyTimeline(): MollyTimeline {
  let def: SimstimTimeline | null = null;
  let playback = 0;
  let waiting = false;
  let lastMeat = 0;
  let meat = 0;
  const fired: SpokenLine[] = [];
  const spoken = new Set<number>();
  const cam: CameraSample = {
    pos: { x: 0, y: 1.6, z: 0 },
    look: { x: 0, y: 1.6, z: -1 },
    bob: 0,
  };
  const figScratch: FigureSample[] = [];
  const sampleOut: TimelineSample = {
    camera: cam,
    figures: figScratch,
    line: null,
    clock: '00:00:00',
    playbackTime: 0,
    waiting: false,
  };

  const fillFigures = (t: number): void => {
    if (!def) {
      figScratch.length = 0;
      return;
    }
    let n = 0;
    for (const f of def.figures) {
      if (f.keys.length === 0) continue;
      const { a, b, u } = seg(f.keys, t);
      let slot = figScratch[n];
      if (!slot) {
        slot = { id: f.id, rig: f.rig, pose: a.pose, pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
        figScratch[n] = slot;
      }
      slot.id = f.id;
      slot.rig = f.rig;
      slot.pose = u < 0.5 ? a.pose : b.pose;
      lerpVec(a.pos, b.pos, u, slot.pos);
      slot.yaw = lerp(a.yaw, b.yaw, u);
      n += 1;
    }
    figScratch.length = n;
  };

  const api: MollyTimeline = {
    get def() {
      return def;
    },
    get playbackTime() {
      return playback;
    },
    get waiting() {
      return waiting;
    },
    get firedLines() {
      return fired;
    },
    load(next) {
      def = next;
      playback = 0;
      waiting = false;
      lastMeat = 0;
      meat = 0;
      spoken.clear();
      fired.length = 0;
    },
    reset() {
      playback = 0;
      waiting = false;
      lastMeat = 0;
      meat = 0;
      spoken.clear();
      fired.length = 0;
    },
    update(dt, meatTime, waitPlayback) {
      fired.length = 0;
      if (!def) {
        playback = meatTime;
        return;
      }
      waiting = waitPlayback !== null;
      if (waiting) {
        playback = waitPlayback!;
      } else if (lastMeat === 0 && meatTime > 0) {
        playback = meatTime;
      } else {
        playback += Math.max(0, dt);
      }
      lastMeat = meatTime;
      meat = meatTime;
      for (let i = 0; i < def.lines.length; i++) {
        const line = def.lines[i]!;
        if (spoken.has(i) || playback < line.t) continue;
        spoken.add(i);
        fired.push(line);
      }
    },
    sample(out) {
      const dest = out ?? sampleOut;
      sampleCameraPath(def?.cameraPath ?? [], playback, dest.camera);
      fillFigures(playback);
      dest.figures = figScratch;
      dest.line = fired[0] ?? null;
      dest.clock = chipClockAt(def?.clockStart ?? '00:00:00', meat);
      dest.playbackTime = playback;
      dest.waiting = waiting;
      return dest;
    },
  };
  return api;
}
