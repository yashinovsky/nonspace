import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

export interface Reticle {
  readonly object: BeamBatchGpu['object'];
  layout(cx: number, cy: number, arm: number, z: number): void;
  update(): void;
  dispose(): void;
}

/**
 * Center vector cross. Breach Phase Lock knobs are M4 — this is the idle reticle only.
 */
export function createReticle(palette: Palette, opts: { z?: number } = {}): Reticle {
  const z0 = opts.z ?? -1;
  const batch = createBeamBatch(palette, {
    capacity: 8,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.6, dwell: 0.8, dwellSigma: 1.8 },
  });
  batch.object.name = 'HudReticle';
  batch.material.depthTest = false;
  let cx = 0;
  let cy = 0;
  let arm = 18;
  let z = z0;

  const push = (x0: number, y0: number, x1: number, y1: number): void => {
    _a.x = x0;
    _a.y = y0;
    _a.z = z;
    _b.x = x1;
    _b.y = y1;
    _b.z = z;
    batch.push(_a, _b, Beam.ICE, 1.15, 1.45, BeamFlag.NO_FOG | BeamFlag.DWELL);
  };

  return {
    object: batch.object,
    layout(nx, ny, nArm, nz) {
      cx = nx;
      cy = ny;
      arm = nArm;
      z = nz;
    },
    update() {
      const gap = Math.max(4, arm * 0.28);
      const tick = Math.max(3, arm * 0.18);
      batch.beginDynamic();
      push(cx - arm, cy, cx - gap, cy);
      push(cx + gap, cy, cx + arm, cy);
      push(cx, cy - arm, cx, cy - gap);
      push(cx, cy + gap, cx, cy + arm);
      // Fine ticks at the gap, Battlezone-style — not a hex ring.
      push(cx - gap, cy - tick, cx - gap, cy + tick);
      push(cx + gap, cy - tick, cx + gap, cy + tick);
      batch.endDynamic();
    },
    dispose() {
      batch.dispose();
    },
  };
}
