import { BEAM_COUNT, type Beam } from './lines/BeamBatch';

/** THREE.Color satisfies this structurally. Channels are 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Nominal beam colors from plan §5.3, indexed by Beam. */
export const BEAM_HEX: readonly number[] = [
  0xa8d8ff, // GRID
  0xc6f03a, // AFTERGLOW
  0x4dff5a, // MITSU
  0x14c77a, // TA
  0xff3b1f, // ESFA
  0xffb000, // AMBER
  0xe4ffff, // ICE
  0xb9a6ff, // MIL
];

/** Provisional Neuromancer warmth target; owned by M1.1/M7.3. */
export const WARMTH_HEX = 0xffa060;

export function hexToRgb(hex: number): Rgb {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}

/**
 * Global beam palette shared by every beam/point material through one uniform
 * (`uniform vec3 uPalette[BEAM_COUNT]`), so AI effects recolor everything at
 * once. Values are the §5.3 hex codes as 0..1; color-space handling is M1.1's.
 */
export interface Palette {
  readonly uniform: { value: Float32Array };
  set(index: Beam, rgb: Rgb): void;
  get(index: Beam, out: Rgb): Rgb;
  /** Wintermute overexposure: blend every entry toward `rgb` by t (0 = off). */
  lerpAllTo(rgb: Rgb, t: number): void;
  /** Neuromancer softening: blend toward warm by t (0 = off). */
  addWarmth(t: number): void;
  reset(): void;
}

export function createPalette(): Palette {
  const base = new Float32Array(BEAM_COUNT * 3);
  const out = new Float32Array(BEAM_COUNT * 3);
  const lerpTarget: Rgb = { r: 1, g: 1, b: 1 };
  const warm = hexToRgb(WARMTH_HEX);
  let lerpT = 0;
  let warmT = 0;

  const loadDefaults = (): void => {
    for (let i = 0; i < BEAM_COUNT; i++) {
      const hex = BEAM_HEX[i]!;
      base[i * 3] = ((hex >> 16) & 255) / 255;
      base[i * 3 + 1] = ((hex >> 8) & 255) / 255;
      base[i * 3 + 2] = (hex & 255) / 255;
    }
  };

  const recompute = (): void => {
    for (let i = 0; i < BEAM_COUNT * 3; i++) {
      const ch = i % 3;
      const target = ch === 0 ? lerpTarget.r : ch === 1 ? lerpTarget.g : lerpTarget.b;
      const w = ch === 0 ? warm.r : ch === 1 ? warm.g : warm.b;
      let v = base[i]!;
      v += (target - v) * lerpT;
      v += (w - v) * warmT;
      out[i] = v;
    }
  };

  loadDefaults();
  recompute();

  return {
    uniform: { value: out },
    set(index, rgb) {
      base[index * 3] = rgb.r;
      base[index * 3 + 1] = rgb.g;
      base[index * 3 + 2] = rgb.b;
      recompute();
    },
    get(index, o) {
      o.r = out[index * 3]!;
      o.g = out[index * 3 + 1]!;
      o.b = out[index * 3 + 2]!;
      return o;
    },
    lerpAllTo(rgb, t) {
      lerpTarget.r = rgb.r;
      lerpTarget.g = rgb.g;
      lerpTarget.b = rgb.b;
      lerpT = Math.min(1, Math.max(0, t));
      recompute();
    },
    addWarmth(t) {
      warmT = Math.min(1, Math.max(0, t));
      recompute();
    },
    reset() {
      lerpT = 0;
      warmT = 0;
      loadDefaults();
      recompute();
    },
  };
}
