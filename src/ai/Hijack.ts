import type { Mesh } from 'three';
import { Beam } from '../render/lines/BeamBatch';
import type { Palette } from '../render/palette';
import { createVfdText, vfdMask, type VfdMode, type VfdText } from '../render/text/VfdText';

/** Wintermute HUD hijack: VFD 14-seg masks re-segment into its words. */
export const HIJACK_MORPH = 0.45;

export function mixMask(from: number, to: number, t: number, salt = 0): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (clamped <= 0) return from;
  if (clamped >= 1) return to;
  let out = 0;
  for (let b = 0; b < 16; b++) {
    const bit = 1 << b;
    const src = from & bit;
    const dst = to & bit;
    if (src === dst) {
      out |= dst;
      continue;
    }
    const thresh = (((salt * 17 + b * 13) % 100) / 100) * 0.35 + 0.3;
    out |= clamped >= thresh ? dst : src;
  }
  return out;
}

export function resegmentMasks(
  from: string,
  to: string,
  t: number,
  mode: VfdMode = 14,
): Uint16Array {
  const n = Math.max(from.length, to.length);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const a = from[i] ?? ' ';
    const b = to[i] ?? ' ';
    out[i] = mixMask(vfdMask(a, mode), vfdMask(b, mode), t, i + 1);
  }
  return out;
}

export interface Hijack {
  readonly object: Mesh;
  readonly text: string;
  readonly morph: number;
  set(text: string): void;
  clear(): void;
  layout(x: number, y: number, z: number, size: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createHijack(palette: Palette, opts: { z?: number } = {}): Hijack {
  const vfd: VfdText = createVfdText(palette, { capacity: 48, ghost: false, size: 14 });
  vfd.material.depthTest = false;
  vfd.object.name = 'HudHijack';
  let text = '';
  let morph = 1;
  let x = 0;
  let y = 0;
  let z = opts.z ?? -1;
  let size = 14;
  let from = '';

  const paint = (): void => {
    if (!text) {
      vfd.object.visible = false;
      vfd.setText('');
      return;
    }
    const masks = resegmentMasks(from, text, morph);
    const pad = text.padEnd(Math.max(from.length, text.length), ' ');
    vfd.setText(pad, {
      x,
      y,
      z,
      size,
      color: Beam.ICE,
      intensity: 1.55,
      mode: 14,
      ghost: false,
      masks,
    });
    vfd.object.visible = true;
  };

  return {
    object: vfd.object,
    get text() {
      return text;
    },
    get morph() {
      return morph;
    },
    set(next) {
      from = text || ' '.repeat(next.length);
      text = next;
      morph = 0;
      paint();
    },
    clear() {
      text = '';
      from = '';
      morph = 1;
      paint();
    },
    layout(nx, ny, nz, s) {
      x = nx;
      y = ny;
      z = nz;
      size = s;
      paint();
    },
    update(dt) {
      if (!text || morph >= 1) return;
      morph = Math.min(1, morph + Math.max(0, dt) / HIJACK_MORPH);
      paint();
    },
    dispose() {
      vfd.dispose();
    },
  };
}
