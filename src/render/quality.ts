import type { QualitySetting } from '../core/settings';

/**
 * Resolved render quality (plan §8.7). `settings.graphics.quality` is
 * `auto|low|medium|high`; this module maps that onto a concrete tier and the
 * knobs M1 passes read. `auto` is resolved from GPU caps, not stored.
 */

export const QUALITY_TIERS = ['low', 'medium', 'high'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export const MAX_PIXEL_RATIO = 2;

/** Plan §8.7 draw-call budget (batch per material / LOD; instancing). */
export const DRAW_CALL_CAP = 150;
/** Lattice window cap (also `LocalLattice` LATTICE_MAX_SEGMENTS). */
export const LATTICE_SEGMENT_CAP = 6_000;
/** HUD line-segment cap. */
export const HUD_SEGMENT_CAP = 5_000;
/** Authored High sky (one PointBatch draw). Lower tiers scale this. */
export const SKY_POINT_BUDGET_HIGH = 40_000;

export interface GpuCaps {
  /** Half-float (or float) color render targets are usable. */
  hdr: boolean;
  /** `WEBGL_debug_renderer_info` UNMASKED_RENDERER, else `gl.RENDERER`. */
  renderer: string;
}

export interface QualityConfig {
  readonly setting: QualitySetting;
  readonly tier: QualityTier;
  /** Scene/post scale before dynamic resolution. Low = ⅔. */
  readonly baseScale: number;
  /** Phosphor persistence. Off on Low and when Reduce Motion is on. */
  readonly persistence: boolean;
  /** Bloom downsample count. Low 4, Medium 5, High 6. */
  readonly bloomMips: number;
  /** Local lattice reveal radius (world units). Low 120, High 200. */
  readonly latticeRadius: number;
  readonly maxLineSegments: number;
  readonly maxPoints: number;
  /** Low may fall back to RGBA8; other tiers want 16F when the GPU allows it. */
  readonly allowRgba8Fallback: boolean;
  /** Actual target type: false means RGBA8 even if the GPU could do 16F. */
  readonly hdr: boolean;
}

export interface QualityOpts {
  reduceMotion?: boolean;
  /**
   * Pretend half-float color RTs are missing (no-float-RT browser / `?hdr=0`).
   * Forces RGBA8 and, with `auto`, the Low tier.
   */
  forceRgba8?: boolean;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|gdi generic/i;
const DISCRETE_GPU = /nvidia|geforce|quadro|radeon rx|radeon pro|radeon vii|rtx |gtx |arc a\d/i;
const APPLE_SILICON = /apple m[1-9]/i;
const INTEGRATED_GPU = /intel|iris|uhd graphics|adreno|mali|apple gpu|amd radeon graphics/i;

const PRESETS: Record<
  QualityTier,
  Omit<QualityConfig, 'setting' | 'tier' | 'hdr' | 'persistence'> & { persistence: boolean }
> = {
  low: {
    baseScale: 2 / 3,
    persistence: false,
    bloomMips: 4,
    latticeRadius: 120,
    maxLineSegments: 40_000,
    maxPoints: 20_000,
    allowRgba8Fallback: true,
  },
  medium: {
    baseScale: 1,
    persistence: true,
    bloomMips: 5,
    latticeRadius: 160,
    maxLineSegments: 80_000,
    maxPoints: 40_000,
    allowRgba8Fallback: false,
  },
  high: {
    baseScale: 1,
    persistence: true,
    bloomMips: 6,
    latticeRadius: 200,
    maxLineSegments: 150_000,
    maxPoints: 60_000,
    allowRgba8Fallback: false,
  },
};

export function pickAutoTier(caps: GpuCaps): QualityTier {
  if (!caps.hdr) return 'low';
  const name = caps.renderer;
  if (SOFTWARE_GPU.test(name)) return 'low';
  if (DISCRETE_GPU.test(name) || APPLE_SILICON.test(name)) return 'high';
  if (INTEGRATED_GPU.test(name)) return 'medium';
  return 'medium';
}

/**
 * Sky lightpoints for a tier (plan §8.7: High sky is 40k in one draw).
 * Scaled so sky + constructs stay inside `maxPoints`. Arm count stays a
 * multiple of 3.
 */
export function skyPointBudget(tier: QualityTier): number {
  if (tier === 'low') return 12_000;
  if (tier === 'medium') return 24_000;
  return SKY_POINT_BUDGET_HIGH;
}

/** Near/mid LOD distances track lattice radius (Low 120, High 200). */
export function lodDistancesFor(tier: QualityTier): { near: number; mid: number } {
  const near = PRESETS[tier].latticeRadius;
  return { near, mid: near * 10 };
}

export function clampVisible(count: number, cap: number): number {
  const n = count | 0;
  const c = cap | 0;
  if (n <= 0 || c <= 0) return 0;
  return n < c ? n : c;
}

export function resolveQuality(
  setting: QualitySetting,
  caps: GpuCaps,
  opts: QualityOpts = {},
): QualityConfig {
  const hdr = caps.hdr && !opts.forceRgba8;
  const resolved: GpuCaps = hdr === caps.hdr ? caps : { ...caps, hdr };
  const tier = setting === 'auto' ? pickAutoTier(resolved) : setting;
  const preset = PRESETS[tier];
  return {
    setting,
    tier,
    ...preset,
    persistence: preset.persistence && !opts.reduceMotion,
    // Use 16F whenever the probe succeeded. Low *allows* RGBA8 as a fallback
    // when HDR is missing; it does not force 8-bit on capable GPUs.
    hdr,
  };
}

export function isQualitySetting(value: string | null): value is QualitySetting {
  return value === 'auto' || value === 'low' || value === 'medium' || value === 'high';
}
