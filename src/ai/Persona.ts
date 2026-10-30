import type { Group } from 'three';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import type { Palette } from '../render/palette';
import { isPersonaId, PERSONA_PATHS, type PersonaId } from './personaPaths';

/** Unstable 3:2 Lissajous (slightly detuned so the figure rolls). */
export const PERSONA_RATIO_A = 3.04;
export const PERSONA_RATIO_B = 2;
export const PERSONA_WOBBLE = 0.045;

export function lissajousOffset(
  t: number,
  index: number,
  amp = PERSONA_WOBBLE,
): { x: number; y: number } {
  const ph = index * 0.37;
  return {
    x: amp * Math.sin(PERSONA_RATIO_A * t + ph),
    y: amp * Math.sin(PERSONA_RATIO_B * t),
  };
}

export function personaId(who: string): PersonaId {
  return isPersonaId(who) ? who : 'finn';
}

export function countPersonaSegments(who: string): number {
  const paths = PERSONA_PATHS[personaId(who)];
  let n = 0;
  for (const path of paths) n += Math.max(0, path.points.length / 2 - 1);
  return n;
}

export interface Persona {
  readonly object: Group;
  readonly who: string | null;
  readonly segmentCount: number;
  setWho(who: string | null, on?: boolean): void;
  setPose(x: number, y: number, z: number, scale: number): void;
  update(time: number): void;
  dispose(): void;
}

export interface CreatePersonaOptions {
  z?: number;
  scale?: number;
}

/**
 * White vector line-portrait. Vertices wobble on an unstable Lissajous;
 * not a textured face (plan §3.8).
 */
export function createPersona(palette: Palette, opts: CreatePersonaOptions = {}): Persona {
  const batch: BeamBatchGpu = createBeamBatch(palette, {
    capacity: 256,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.7, dwell: 1.1, dwellSigma: 2.2 },
  });
  batch.object.name = 'AiPersona';
  batch.material.depthTest = false;

  let who: PersonaId | null = null;
  let scale = opts.scale ?? 8;
  let ox = 0;
  let oy = 0;
  let oz = opts.z ?? 0;
  let segments = 0;
  let time = 0;

  const rebuild = (t: number): void => {
    if (!who) {
      batch.beginDynamic();
      batch.endDynamic();
      batch.visible = false;
      segments = 0;
      return;
    }
    const paths = PERSONA_PATHS[who];
    batch.beginDynamic();
    let n = 0;
    const a = { x: 0, y: 0, z: oz };
    const b = { x: 0, y: 0, z: oz };
    for (const path of paths) {
      const pts = path.points;
      const count = pts.length / 2;
      for (let i = 0; i < count - 1; i++) {
        const w0 = lissajousOffset(t, n, PERSONA_WOBBLE);
        const w1 = lissajousOffset(t, n + 1, PERSONA_WOBBLE);
        a.x = ox + (pts[i * 2]! + w0.x) * scale;
        a.y = oy + (pts[i * 2 + 1]! + w0.y) * scale;
        a.z = oz;
        b.x = ox + (pts[i * 2 + 2]! + w1.x) * scale;
        b.y = oy + (pts[i * 2 + 3]! + w1.y) * scale;
        b.z = oz;
        batch.push(a, b, Beam.ICE, 2.6, 1.7, BeamFlag.NO_FOG | BeamFlag.DWELL);
        n++;
      }
    }
    batch.endDynamic();
    batch.visible = n > 0;
    segments = n;
  };

  return {
    object: batch.object,
    get who() {
      return who;
    },
    get segmentCount() {
      return segments;
    },
    setWho(next, on = true) {
      if (!on || !next) {
        who = null;
        rebuild(time);
        return;
      }
      who = personaId(next);
      rebuild(time);
    },
    setPose(x, y, z, s) {
      ox = x;
      oy = y;
      oz = z;
      scale = s;
      rebuild(time);
    },
    update(t) {
      time = t;
      if (who) rebuild(t);
    },
    dispose() {
      batch.dispose();
    },
  };
}

/** CPU helper for tests: portrait as a LineSet at t = 0. */
export function personaLineSet(who: string, scale = 1): ReturnType<typeof createLineSet> {
  const id = personaId(who);
  const n = countPersonaSegments(id);
  const set = createLineSet(n, { width: true, flags: true });
  let k = 0;
  for (const path of PERSONA_PATHS[id]) {
    const pts = path.points;
    const count = pts.length / 2;
    for (let i = 0; i < count - 1; i++) {
      const p = k * 6;
      set.positions[p] = pts[i * 2]! * scale;
      set.positions[p + 1] = pts[i * 2 + 1]! * scale;
      set.positions[p + 2] = 0;
      set.positions[p + 3] = pts[i * 2 + 2]! * scale;
      set.positions[p + 4] = pts[i * 2 + 3]! * scale;
      set.positions[p + 5] = 0;
      set.color[k] = Beam.ICE;
      set.intensity[k] = 2.6;
      set.width![k] = 1.7;
      set.flags![k] = BeamFlag.NO_FOG | BeamFlag.DWELL;
      k++;
    }
  }
  return set;
}
