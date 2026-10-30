import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';

/** 10-segment LED trace meter (plan §6.2). */
export const TRACE_SEGMENTS = 10;
export const TRACE_BLINK_HZ = 2;
export const TRACE_BLINK_FROM = 0.9;

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

function pushBox(
  batch: BeamBatchGpu,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  color: Beam,
  intensity: number,
): void {
  const x1 = x + w;
  const y1 = y + h;
  _a.z = z;
  _b.z = z;
  _a.x = x;
  _a.y = y;
  _b.x = x1;
  _b.y = y;
  batch.push(_a, _b, color, intensity, 1.6, BeamFlag.NO_FOG);
  _a.x = x1;
  _a.y = y;
  _b.x = x1;
  _b.y = y1;
  batch.push(_a, _b, color, intensity, 1.6, BeamFlag.NO_FOG);
  _a.x = x1;
  _a.y = y1;
  _b.x = x;
  _b.y = y1;
  batch.push(_a, _b, color, intensity, 1.6, BeamFlag.NO_FOG);
  _a.x = x;
  _a.y = y1;
  _b.x = x;
  _b.y = y;
  batch.push(_a, _b, color, intensity, 1.6, BeamFlag.NO_FOG);
  // Fill: two diagonals so the cell reads as a lit LED, not a hollow frame.
  if (intensity > 0.2) {
    _a.x = x + 1;
    _a.y = y + 1;
    _b.x = x1 - 1;
    _b.y = y1 - 1;
    batch.push(_a, _b, color, intensity * 0.85, 1.2, BeamFlag.NO_FOG);
    _a.x = x1 - 1;
    _a.y = y + 1;
    _b.x = x + 1;
    _b.y = y1 - 1;
    batch.push(_a, _b, color, intensity * 0.85, 1.2, BeamFlag.NO_FOG);
  }
}

export function traceColor(index: number): Beam {
  if (index >= 8) return Beam.ESFA;
  if (index >= 5) return Beam.AMBER;
  return Beam.MITSU;
}

/** How many of the 10 LEDs are on for a 0..1 trace value. Position is the identity, not hue. */
export function traceLitCount(trace01: number): number {
  const t = trace01 < 0 ? 0 : trace01 > 1 ? 1 : trace01;
  return Math.round(t * TRACE_SEGMENTS);
}

/** Zone of a cell: left / mid / right. Colorblind-safe even if hues collapse. */
export function traceZone(index: number): 'low' | 'mid' | 'high' {
  if (index >= 8) return 'high';
  if (index >= 5) return 'mid';
  return 'low';
}

/** Last LED blinks at 2 Hz when trace ≥ 90%. Returns intensity 0..1 for that cell. */
export function traceBlink(trace01: number, time: number, reduceFlashing: boolean): number {
  if (trace01 < TRACE_BLINK_FROM) return 1;
  if (reduceFlashing) return 0.7;
  return (time * TRACE_BLINK_HZ) % 1 < 0.5 ? 1 : 0.08;
}

export interface Bargraph {
  readonly object: BeamBatchGpu['object'];
  layout(x: number, y: number, w: number, h: number, z: number): void;
  /** `trace` is 0..100. */
  update(trace: number, time: number, reduceFlashing: boolean): void;
  dispose(): void;
}

export function createBargraph(palette: Palette, opts: { z?: number } = {}): Bargraph {
  const z0 = opts.z ?? -1;
  const batch = createBeamBatch(palette, {
    capacity: TRACE_SEGMENTS * 10,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.55, dwell: 0 },
  });
  batch.object.name = 'HudBargraph';
  batch.material.depthTest = false;
  let x = 0;
  let y = 0;
  let w = 120;
  let h = 16;
  let z = z0;

  return {
    object: batch.object,
    layout(nx, ny, nw, nh, nz) {
      x = nx;
      y = ny;
      w = nw;
      h = nh;
      z = nz;
    },
    update(trace, time, reduceFlashing) {
      const t01 = trace / 100;
      const lit = traceLitCount(t01);
      const gap = Math.max(2, w * 0.04);
      const cell = (w - gap * (TRACE_SEGMENTS - 1)) / TRACE_SEGMENTS;
      const blink = traceBlink(t01, time, reduceFlashing);
      batch.beginDynamic();
      for (let i = 0; i < TRACE_SEGMENTS; i++) {
        const on = i < lit;
        let intensity = on ? 1.25 : 0.09;
        if (on && i === TRACE_SEGMENTS - 1) intensity *= blink;
        const cx = x + i * (cell + gap);
        pushBox(batch, cx, y, cell, h, z, traceColor(i), intensity);
        // Position hash: 1/2/3 ticks by zone so grayscale still reads the meter.
        if (on) {
          const ticks = traceZone(i) === 'high' ? 3 : traceZone(i) === 'mid' ? 2 : 1;
          for (let k = 0; k < ticks; k++) {
            const tx = cx + cell * (0.28 + k * 0.22);
            _a.x = tx;
            _a.y = y + 2;
            _b.x = tx;
            _b.y = y + h - 2;
            _a.z = z;
            _b.z = z;
            batch.push(_a, _b, Beam.GRID, intensity * 0.9, 1.1, BeamFlag.NO_FOG);
          }
        }
      }
      batch.endDynamic();
    },
    dispose() {
      batch.dispose();
    },
  };
}
