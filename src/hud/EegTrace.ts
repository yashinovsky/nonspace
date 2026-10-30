import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';

/** Calm alpha-wave frequency (plan §6.2). */
export const EEG_ALPHA_HZ = 10;
export const EEG_SAMPLES = 96;

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

function hash11(n: number): number {
  let x = n * 0.1031;
  x = x - Math.floor(x);
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

function scarGlitch(t: number, scars: number): number {
  if (!(scars > 0)) return 0;
  let g = 0;
  for (let i = 0; i < scars; i++) {
    const phase = hash11(i * 19.17 + 3.1);
    const w = (((t * 7.3 + phase) % 1) + 1) % 1;
    if (w < 0.012) g += (hash11(i + Math.floor(t * 60)) - 0.5) * 0.35;
  }
  return g;
}

/**
 * Neural 0 = calm sine, 1 = ragged high-amp irregular, flatline = 0.
 * Scars add a permanent tiny tick. Pure; no allocations.
 */
export function eegSample(t: number, neural01: number, flatline: boolean, scars = 0): number {
  const scar = scarGlitch(t, scars);
  if (flatline) return scar * 0.15;
  const n = neural01 < 0 ? 0 : neural01 > 1 ? 1 : neural01;
  const alpha = Math.sin(t * Math.PI * 2 * EEG_ALPHA_HZ) * 0.22;
  const beta =
    Math.sin(t * Math.PI * 2 * 23.7 + 0.4) * 0.14 + Math.sin(t * Math.PI * 2 * 31.1 + 1.7) * 0.1;
  const burst = (hash11(Math.floor(t * 42) + 17) - 0.5) * 2;
  const ragged = (beta * 2.4 + burst * (0.28 + n * 1.05)) * (0.4 + n);
  return alpha * (1 - n) + ragged * n + scar;
}

export function eegVariance(samples: ArrayLike<number>, count: number): number {
  const n = Math.max(0, Math.min(count, samples.length));
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i]!;
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[i]! - mean;
    v += d * d;
  }
  return v / n;
}

export interface EegTrace {
  readonly samples: Float32Array;
  readonly sampleCount: number;
  readonly object: BeamBatchGpu['object'];
  layout(x: number, y: number, w: number, h: number, z: number): void;
  /** `neural` is 0..100. */
  update(time: number, neural: number, flatline: boolean, scars?: number): void;
  dispose(): void;
}

export function createEegTrace(palette: Palette, opts: { z?: number } = {}): EegTrace {
  const z0 = opts.z ?? -1;
  const samples = new Float32Array(EEG_SAMPLES);
  const batch = createBeamBatch(palette, {
    capacity: EEG_SAMPLES,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.7, dwell: 0 },
  });
  batch.object.name = 'HudEeg';
  batch.material.depthTest = false;
  let x = 0;
  let y = 0;
  let w = 120;
  let h = 28;
  let z = z0;

  return {
    samples,
    sampleCount: EEG_SAMPLES,
    object: batch.object,
    layout(nx, ny, nw, nh, nz) {
      x = nx;
      y = ny;
      w = nw;
      h = nh;
      z = nz;
    },
    update(time, neural, flatline, scars = 0) {
      const n01 = neural / 100;
      const dt = 1 / 60;
      for (let i = 0; i < EEG_SAMPLES; i++) {
        const t = time - (EEG_SAMPLES - 1 - i) * dt;
        samples[i] = eegSample(t, n01, flatline, scars);
      }
      const mid = y + h * 0.5;
      const amp = h * 0.42;
      const dx = w / Math.max(1, EEG_SAMPLES - 1);
      batch.beginDynamic();
      for (let i = 0; i < EEG_SAMPLES - 1; i++) {
        _a.x = x + i * dx;
        _a.y = mid + samples[i]! * amp;
        _a.z = z;
        _b.x = x + (i + 1) * dx;
        _b.y = mid + samples[i + 1]! * amp;
        _b.z = z;
        const hot = Math.max(Math.abs(samples[i]!), Math.abs(samples[i + 1]!));
        const intensity = flatline ? 0.85 : 1.05 + hot * 0.5;
        batch.push(_a, _b, Beam.MITSU, intensity, 1.35, BeamFlag.NO_FOG);
      }
      batch.endDynamic();
    },
    dispose() {
      batch.dispose();
    },
  };
}
