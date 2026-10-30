import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';

/** PPI sweep rate (plan §6.2). */
export const RADAR_SWEEP_HZ = 0.5;
const RING = 48;
const TRAIL = 18;

export type RadarBlipKind = 'target' | 'ice' | 'watcher' | 'kuang';

export interface RadarBlip {
  /** 0..2π, 0 = +X (right). */
  angle: number;
  /** 0..1 of radar radius. */
  radius: number;
  kind: RadarBlipKind;
}

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

function blipColor(kind: RadarBlipKind): Beam {
  if (kind === 'ice') return Beam.ICE;
  if (kind === 'watcher') return Beam.MIL;
  if (kind === 'kuang') return Beam.ESFA;
  return Beam.AMBER;
}

export function radarSweepAngle(time: number): number {
  return ((time * RADAR_SWEEP_HZ) % 1) * Math.PI * 2;
}

export interface Radar {
  readonly object: BeamBatchGpu['object'];
  layout(cx: number, cy: number, radius: number, z: number): void;
  update(time: number, blips: readonly RadarBlip[]): void;
  dispose(): void;
}

export function createRadar(palette: Palette, opts: { z?: number } = {}): Radar {
  const z0 = opts.z ?? -1;
  const batch = createBeamBatch(palette, {
    capacity: RING * 3 + TRAIL + 32,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.65, dwell: 0.4, dwellSigma: 1.6 },
  });
  batch.object.name = 'HudRadar';
  batch.material.depthTest = false;
  let cx = 0;
  let cy = 0;
  let r = 70;
  let z = z0;

  const push = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: Beam,
    i: number,
    w = 1.35,
    f = BeamFlag.NO_FOG,
  ): void => {
    _a.x = x0;
    _a.y = y0;
    _a.z = z;
    _b.x = x1;
    _b.y = y1;
    _b.z = z;
    batch.push(_a, _b, c, i, w, f);
  };

  return {
    object: batch.object,
    layout(nx, ny, nr, nz) {
      cx = nx;
      cy = ny;
      r = nr;
      z = nz;
    },
    update(time, blips) {
      const sweep = radarSweepAngle(time);
      batch.beginDynamic();
      for (let ring = 1; ring <= 3; ring++) {
        const rr = (r * ring) / 3;
        const intensity = ring === 3 ? 0.95 : 0.35;
        for (let i = 0; i < RING; i++) {
          const a0 = (i / RING) * Math.PI * 2;
          const a1 = ((i + 1) / RING) * Math.PI * 2;
          push(
            cx + Math.cos(a0) * rr,
            cy + Math.sin(a0) * rr,
            cx + Math.cos(a1) * rr,
            cy + Math.sin(a1) * rr,
            Beam.AFTERGLOW,
            intensity,
            ring === 3 ? 1.4 : 1.1,
          );
        }
      }
      push(cx - r, cy, cx + r, cy, Beam.AFTERGLOW, 0.28, 1);
      push(cx, cy - r, cx, cy + r, Beam.AFTERGLOW, 0.28, 1);

      // P7 afterglow: fading fan behind the sweep.
      const da = 0.045;
      for (let i = 0; i < TRAIL; i++) {
        const a = sweep - i * da;
        const fade = Math.exp(-i * 0.22);
        push(
          cx,
          cy,
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r,
          Beam.AFTERGLOW,
          0.15 + fade * 1.1,
          i === 0 ? 1.8 : 1.15,
        );
      }

      for (let i = 0; i < blips.length; i++) {
        const b = blips[i]!;
        const rr = Math.min(1, Math.max(0, b.radius)) * r * 0.92;
        const px = cx + Math.cos(b.angle) * rr;
        const py = cy + Math.sin(b.angle) * rr;
        const s = 3.2;
        const c = blipColor(b.kind);
        push(px - s, py, px + s, py, c, 1.6, 1.8, BeamFlag.NO_FOG | BeamFlag.DWELL);
        push(px, py - s, px, py + s, c, 1.6, 1.8, BeamFlag.NO_FOG | BeamFlag.DWELL);
      }
      batch.endDynamic();
    },
    dispose() {
      batch.dispose();
    },
  };
}
