/**
 * Coordinate-jump streak (plan §3.4 / §5.9). Longitudinal phosphor lines along
 * the travel axis plus a growing destination lightpoint. 1984 vector CRT —
 * additive GRID/ICE, not neon. Persistence decay and FOV live on the jump sim
 * / PersistencePass; this module does not edit sibling post passes.
 */

import type { Scene } from 'three';
import type { Vec3 } from '../../core/math/vec3';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../lines/BeamBatch';
import { createPointBatch, type GpuPointBatch } from '../points/PointBatch';
import type { Palette } from '../palette';
import type { JumpPhase } from '../../player/CoordinateJump';

export const JUMP_STREAK_LINES = 36;
export const JUMP_STREAK_DECAY = 0.35;
export const JUMP_STREAK_DECAY_REDUCED = 0.7;

export interface JumpStreakSample {
  phase: JumpPhase;
  u: number;
  fovKick: number;
  decayScale: number;
  pitchRise: number;
  destGrow: number;
  streak: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function envelope(u: number): number {
  const x = clamp01(u);
  return Math.sin(Math.PI * x);
}

/** CPU twin of the streak look. `u` is streak progress 0..1. */
export function sampleJumpStreak(
  phase: JumpPhase,
  u: number,
  reduceMotion = false,
): JumpStreakSample {
  if (phase === 'idle' || phase === 'done' || phase === 'align') {
    return {
      phase,
      u: 0,
      fovKick: 0,
      decayScale: 1,
      pitchRise: 0,
      destGrow: phase === 'done' ? 1 : phase === 'align' ? 0.15 : 0,
      streak: 0,
    };
  }
  const e = envelope(u);
  return {
    phase,
    u: clamp01(u),
    fovKick: reduceMotion ? 0 : 25 * e,
    decayScale: reduceMotion ? JUMP_STREAK_DECAY_REDUCED : JUMP_STREAK_DECAY,
    pitchRise: (reduceMotion ? 0.04 : 0.12) * e,
    destGrow: 0.2 + 0.8 * clamp01(u),
    streak: e,
  };
}

export interface JumpStreak {
  readonly lines: BeamBatchGpu;
  readonly points: GpuPointBatch;
  update(from: Vec3, to: Vec3, sample: JumpStreakSample, viewport?: { w: number; h: number }): void;
  dispose(): void;
}

export interface JumpStreakOptions {
  palette: Palette;
  scene: Scene;
}

const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 0, z: 0 };
const P = { x: 0, y: 0, z: 0 };

export function createJumpStreak(opts: JumpStreakOptions): JumpStreak {
  const lines = createBeamBatch(opts.palette, { capacity: JUMP_STREAK_LINES + 8 });
  const points = createPointBatch({ capacity: 4, palette: opts.palette, fogDensity: 0 });
  opts.scene.add(lines.object);
  opts.scene.add(points.object);
  lines.object.name = 'JumpStreakLines';
  points.object.name = 'JumpStreakDest';

  const streak: JumpStreak = {
    lines,
    points,
    update(from, to, sample, viewport) {
      const on = sample.streak > 0.02 || sample.destGrow > 0.05;
      lines.visible = on;
      points.visible = on;
      if (viewport) points.setViewport(viewport.w, viewport.h);

      let dx = to.x - from.x;
      let dy = to.y - from.y;
      let dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 1e-4)) {
        dx = 0;
        dy = 0;
        dz = -1;
      } else {
        dx /= len;
        dy /= len;
        dz /= len;
      }
      // Orthonormal frame for the cylinder of streaks.
      let rx = -dz;
      let ry = 0;
      let rz = dx;
      const rlen = Math.hypot(rx, ry, rz);
      if (rlen < 1e-4) {
        rx = 1;
        ry = 0;
        rz = 0;
      } else {
        rx /= rlen;
        ry /= rlen;
        rz /= rlen;
      }
      const ux = dy * rz - dz * ry;
      const uy = dz * rx - dx * rz;
      const uz = dx * ry - dy * rx;

      const n = sample.streak > 0.02 ? JUMP_STREAK_LINES : 0;
      const reach = 90 + 520 * sample.streak;
      const radius = 6 + 22 * sample.streak;
      const amp = 0.55 + 1.8 * sample.streak;
      lines.beginDynamic();
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const ox = (rx * c + ux * s) * radius;
        const oy = (ry * c + uy * s) * radius;
        const oz = (rz * c + uz * s) * radius;
        A.x = from.x + ox - dx * reach * 0.15;
        A.y = from.y + oy - dy * reach * 0.15;
        A.z = from.z + oz - dz * reach * 0.15;
        B.x = from.x + ox + dx * reach;
        B.y = from.y + oy + dy * reach;
        B.z = from.z + oz + dz * reach;
        const ice = (i & 1) === 0;
        lines.push(
          A,
          B,
          ice ? Beam.ICE : Beam.GRID,
          amp * (ice ? 1.15 : 0.85),
          ice ? 2.1 : 1.4,
          BeamFlag.NO_FOG | ((i & 3) === 0 ? BeamFlag.DWELL : 0),
        );
      }
      lines.endDynamic();

      points.beginDynamic();
      if (sample.destGrow > 0.02) {
        P.x = to.x;
        P.y = to.y;
        P.z = to.z;
        points.push(P, Beam.ICE, 1.2 + 6.5 * sample.destGrow, 6 + 36 * sample.destGrow);
      }
      points.endDynamic();
    },
    dispose() {
      opts.scene.remove(lines.object);
      opts.scene.remove(points.object);
      lines.dispose();
      points.dispose();
    },
  };
  return streak;
}
