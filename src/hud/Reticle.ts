import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';

/** Same log range as PhaseLock knobs (0.25–4.0). Inlined so HUD stays off the boot graph. */
const LN_RATIO_MIN = Math.log(0.25);
const LN_RATIO_MAX = Math.log(4);

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

/** Phase Lock knob overlay (plan §6.2). Vector arcs, not a hex ring. */
export interface ReticleLock {
  meter: number;
  m: number;
  lnR: number;
  targetLnR: number;
  Phi: number;
  phi: number;
  telegraph: boolean;
}

export interface Reticle {
  readonly object: BeamBatchGpu['object'];
  layout(cx: number, cy: number, arm: number, z: number): void;
  update(lock?: ReticleLock | null): void;
  dispose(): void;
}

const LOCK_SEGS = 28;
const RATIO_TICKS = 7;
const PHASE_SEGS = 16;

/**
 * Center vector cross. In breach it becomes the lock-meter ring, ratio arc
 * and phase dial (Battlezone ticks, 1984 CRT — not a hex "breach protocol").
 */
export function createReticle(palette: Palette, opts: { z?: number } = {}): Reticle {
  const z0 = opts.z ?? -1;
  const batch = createBeamBatch(palette, {
    capacity: LOCK_SEGS + RATIO_TICKS + PHASE_SEGS + 16,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.6, dwell: 0.8, dwellSigma: 1.8 },
  });
  batch.object.name = 'HudReticle';
  batch.material.depthTest = false;
  let cx = 0;
  let cy = 0;
  let arm = 18;
  let z = z0;

  const push = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: Beam,
    intensity: number,
    width = 1.45,
  ): void => {
    _a.x = x0;
    _a.y = y0;
    _a.z = z;
    _b.x = x1;
    _b.y = y1;
    _b.z = z;
    batch.push(_a, _b, color, intensity, width, BeamFlag.NO_FOG | BeamFlag.DWELL);
  };

  const idle = (): void => {
    const gap = Math.max(4, arm * 0.28);
    const tick = Math.max(3, arm * 0.18);
    push(cx - arm, cy, cx - gap, cy, Beam.ICE, 1.15);
    push(cx + gap, cy, cx + arm, cy, Beam.ICE, 1.15);
    push(cx, cy - arm, cx, cy - gap, Beam.ICE, 1.15);
    push(cx, cy + gap, cx, cy + arm, Beam.ICE, 1.15);
    push(cx - gap, cy - tick, cx - gap, cy + tick, Beam.ICE, 1.15);
    push(cx + gap, cy - tick, cx + gap, cy + tick, Beam.ICE, 1.15);
  };

  const lockChrome = (lock: ReticleLock): void => {
    const r = arm * 2.05;
    const meter = lock.meter < 0 ? 0 : lock.meter > 1 ? 1 : lock.meter;
    const hot = 0.85 + lock.m * 0.55;
    const segs = LOCK_SEGS;
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
      const t1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
      const lit = i / segs <= meter;
      const amp = lit ? hot : 0.22;
      const col = lit ? Beam.ICE : Beam.GRID;
      push(
        cx + Math.cos(t0) * r,
        cy + Math.sin(t0) * r,
        cx + Math.cos(t1) * r,
        cy + Math.sin(t1) * r,
        col,
        amp,
        lit ? 1.8 : 1.1,
      );
    }

    const arcR = arm * 1.35;
    const a0 = Math.PI * 0.7;
    const a1 = Math.PI * 0.3;
    const span = a0 - a1;
    const lnSpan = LN_RATIO_MAX - LN_RATIO_MIN;
    const lnToAng = (ln: number): number => {
      const u = (ln - LN_RATIO_MIN) / lnSpan;
      const c = u < 0 ? 0 : u > 1 ? 1 : u;
      return a0 - c * span;
    };
    for (let i = 0; i < RATIO_TICKS; i++) {
      const ang = a0 - (i / (RATIO_TICKS - 1)) * span;
      const inner = arcR - arm * 0.12;
      push(
        cx + Math.cos(ang) * inner,
        cy + Math.sin(ang) * inner,
        cx + Math.cos(ang) * arcR,
        cy + Math.sin(ang) * arcR,
        Beam.GRID,
        0.7,
        1.1,
      );
    }
    const needle = lnToAng(lock.lnR);
    const target = lnToAng(lock.targetLnR);
    push(cx, cy, cx + Math.cos(needle) * arcR, cy + Math.sin(needle) * arcR, Beam.AMBER, 1.25, 1.5);
    push(
      cx + Math.cos(target) * (arcR + 2),
      cy + Math.sin(target) * (arcR + 2),
      cx + Math.cos(target) * (arcR + arm * 0.22),
      cy + Math.sin(target) * (arcR + arm * 0.22),
      Beam.ICE,
      lock.telegraph ? 0.45 : 1.1,
      1.6,
    );

    const pr = arm * 0.55;
    for (let i = 0; i < PHASE_SEGS; i++) {
      const t0 = (i / PHASE_SEGS) * Math.PI * 2;
      const t1 = ((i + 1) / PHASE_SEGS) * Math.PI * 2;
      push(
        cx + Math.cos(t0) * pr,
        cy + Math.sin(t0) * pr,
        cx + Math.cos(t1) * pr,
        cy + Math.sin(t1) * pr,
        Beam.GRID,
        0.55,
        1.05,
      );
    }
    push(cx, cy, cx + Math.cos(lock.Phi) * pr, cy + Math.sin(lock.Phi) * pr, Beam.AMBER, 1.2, 1.4);
    push(
      cx,
      cy,
      cx + Math.cos(lock.phi) * (pr * 0.72),
      cy + Math.sin(lock.phi) * (pr * 0.72),
      Beam.ICE,
      0.95,
      1.2,
    );
  };

  return {
    object: batch.object,
    layout(nx, ny, nArm, nz) {
      cx = nx;
      cy = ny;
      arm = nArm;
      z = nz;
    },
    update(lock) {
      batch.beginDynamic();
      if (lock) lockChrome(lock);
      else idle();
      batch.endDynamic();
    },
    dispose() {
      batch.dispose();
    },
  };
}
