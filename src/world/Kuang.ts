/**
 * Kuang Grade Mark Eleven: spline of iridescent rib rings that mimic T-A
 * emerald (plan §4.4 M5 Phase B, §8.5 `kuang.frag`).
 */

import { Vector3 } from 'three';
import type { Renderer } from '../render/Renderer';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';
import { createKuangMaterial, setKuangUniforms } from '../render/lines/KuangMaterial';
import {
  coilControls,
  deployControls,
  revealedRibs,
  ribCount,
  sampleSpline,
  writeRib,
  type RibHit,
  type SplineSample,
} from './kuangSpline';

export const KUANG_RIBS = 36;
export const KUANG_SIDES = 10;
export const KUANG_RIB_RADIUS = 0.55;
export const KUANG_MIMIC_S = 6;

const FLAGS = BeamFlag.KUANG | BeamFlag.DWELL | BeamFlag.NO_FOG;
const _a = new Vector3();
const _b = new Vector3();

export type KuangPose = 'deploy' | 'coil';

export interface Kuang {
  readonly object: BeamBatchGpu['object'];
  mimic: number;
  reveal: number;
  time: number;
  pose: KuangPose;
  /** Coil helix follows this camera z (dive). */
  coilZ: number;
  coilRadius: number;
  coilLength: number;
  update(dt: number, reduceMotion?: boolean): void;
  setTime(t: number): void;
  paint(): void;
  dispose(): void;
}

export interface KuangOptions {
  renderer: Renderer;
  pose?: KuangPose;
  mimic?: number;
  reveal?: number;
  coilRadius?: number;
}

export function createKuang(opts: KuangOptions): Kuang {
  const { renderer } = opts;
  const material = createKuangMaterial(renderer.palette, {
    fogDensity: 0.0002,
    fogStart: 40,
    sigma: 0.85,
    dwell: 0.7,
  });
  const cap = ribCount(KUANG_RIBS, KUANG_SIDES) + 8;
  const batch = createBeamBatch(renderer.palette, { material, capacity: cap });
  batch.object.name = 'Kuang';
  renderer.scenes.matrix.add(batch.object);

  const sample: SplineSample = { x: 0, y: 0, z: 0, tx: 0, ty: 1, tz: 0 };
  const ribs: RibHit[] = [];
  const deployPts = deployControls();
  let coilPts = coilControls(opts.coilRadius ?? 8.4, 0, 36);

  const api: Kuang = {
    object: batch.object,
    mimic: opts.mimic ?? 0,
    reveal: opts.reveal ?? 1,
    time: 0,
    pose: opts.pose ?? 'deploy',
    coilZ: 0,
    coilRadius: opts.coilRadius ?? 8.4,
    coilLength: 36,
    update(dt, reduceMotion = false) {
      if (!reduceMotion) api.time += dt;
      paint();
    },
    setTime(t) {
      api.time = t;
      paint();
    },
    paint,
    dispose() {
      renderer.scenes.matrix.remove(batch.object);
      batch.dispose();
      material.dispose();
    },
  };

  function paint(): void {
    const mimic = api.mimic < 0 ? 0 : api.mimic > 1 ? 1 : api.mimic;
    setKuangUniforms(material, api.time, mimic);
    if (api.pose === 'coil') {
      coilPts = coilControls(api.coilRadius, api.coilZ, api.coilLength, 2.4, 12);
    }
    const pts = api.pose === 'coil' ? coilPts : deployPts;
    const nRibs = revealedRibs(KUANG_RIBS, api.reveal);
    const last = Math.max(1, nRibs - 1);
    batch.beginDynamic();
    const intensity = 1.05 + mimic * 0.15;
    for (let i = 0; i < nRibs; i++) {
      sampleSpline(pts, nRibs <= 1 ? 0 : i / last, sample);
      const pulse = 1 + 0.08 * Math.sin(api.time * 2.2 + i * 0.35);
      const w = writeRib(sample, KUANG_RIB_RADIUS * pulse, KUANG_SIDES, ribs, 0);
      // Rib index in flags>>8 so a whole ring shares one spectral hue.
      const flags = FLAGS | ((i & 255) << 8);
      for (let k = 0; k < w; k++) {
        const r = ribs[k]!;
        _a.set(r.ax, r.ay, r.az);
        _b.set(r.bx, r.by, r.bz);
        batch.push(_a, _b, Beam.TA, intensity, 1.55, flags);
      }
    }
    batch.endDynamic();
  }

  paint();
  return api;
}
