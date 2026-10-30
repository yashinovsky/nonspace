import { describe, expect, it } from 'vitest';
import {
  clampVisible,
  DRAW_CALL_CAP,
  HUD_SEGMENT_CAP,
  isQualitySetting,
  LATTICE_SEGMENT_CAP,
  lodDistancesFor,
  pickAutoTier,
  resolveQuality,
  skyPointBudget,
  SKY_POINT_BUDGET_HIGH,
  type GpuCaps,
} from '../../src/render/quality';
import { hasHdrColorBuffer } from '../../src/render/targets';

const caps = (partial: Partial<GpuCaps> = {}): GpuCaps => ({
  hdr: true,
  renderer: 'NVIDIA GeForce RTX 4070',
  ...partial,
});

describe('quality', () => {
  it('maps settings.graphics.quality onto §8.7 tier knobs', () => {
    const low = resolveQuality('low', caps());
    expect(low.tier).toBe('low');
    expect(low.baseScale).toBeCloseTo(2 / 3);
    expect(low.persistence).toBe(false);
    expect(low.bloomMips).toBe(4);
    expect(low.latticeRadius).toBe(120);
    expect(low.maxLineSegments).toBe(40_000);
    expect(low.allowRgba8Fallback).toBe(true);

    const medium = resolveQuality('medium', caps());
    expect(medium.tier).toBe('medium');
    expect(medium.baseScale).toBe(1);
    expect(medium.persistence).toBe(true);
    expect(medium.bloomMips).toBe(5);
    expect(medium.latticeRadius).toBe(160);
    expect(medium.maxLineSegments).toBe(80_000);

    const high = resolveQuality('high', caps());
    expect(high.tier).toBe('high');
    expect(high.bloomMips).toBe(6);
    expect(high.latticeRadius).toBe(200);
    expect(high.maxLineSegments).toBe(150_000);
    expect(high.maxPoints).toBe(60_000);
    expect(low.maxPoints).toBe(20_000);
    expect(medium.maxPoints).toBe(40_000);
  });

  it('keeps §8.7 draw-call / lattice / HUD caps', () => {
    expect(DRAW_CALL_CAP).toBe(150);
    expect(LATTICE_SEGMENT_CAP).toBe(6_000);
    expect(HUD_SEGMENT_CAP).toBe(5_000);
  });

  it('scales sky points so they fit the per-tier point cap', () => {
    expect(skyPointBudget('high')).toBe(SKY_POINT_BUDGET_HIGH);
    expect(skyPointBudget('medium')).toBe(24_000);
    expect(skyPointBudget('low')).toBe(12_000);
    expect(skyPointBudget('low')).toBeLessThanOrEqual(resolveQuality('low', caps()).maxPoints);
    expect(skyPointBudget('medium')).toBeLessThanOrEqual(
      resolveQuality('medium', caps()).maxPoints,
    );
    expect(skyPointBudget('high')).toBeLessThanOrEqual(resolveQuality('high', caps()).maxPoints);
  });

  it('scales LOD distances with lattice radius', () => {
    expect(lodDistancesFor('low')).toEqual({ near: 120, mid: 1_200 });
    expect(lodDistancesFor('medium')).toEqual({ near: 160, mid: 1_600 });
    expect(lodDistancesFor('high')).toEqual({ near: 200, mid: 2_000 });
  });

  it('clamps visible counts to the cap without going negative', () => {
    expect(clampVisible(80_000, 40_000)).toBe(40_000);
    expect(clampVisible(12, 40_000)).toBe(12);
    expect(clampVisible(-4, 10)).toBe(0);
    expect(clampVisible(10, 0)).toBe(0);
  });

  it('Low-tier fallback on a no-float-RT GPU is RGBA8 with persistence off', () => {
    const q = resolveQuality('auto', caps({ hdr: false, renderer: 'Intel Iris Xe Graphics' }));
    expect(q.tier).toBe('low');
    expect(q.hdr).toBe(false);
    expect(q.allowRgba8Fallback).toBe(true);
    expect(q.persistence).toBe(false);
    expect(q.bloomMips).toBe(4);
    expect(q.latticeRadius).toBe(120);
    expect(q.baseScale).toBeCloseTo(2 / 3);
    expect(q.maxLineSegments).toBe(40_000);
  });

  it('forceRgba8 drops HDR even when the probe passed', () => {
    const q = resolveQuality('high', caps({ hdr: true }), { forceRgba8: true });
    expect(q.tier).toBe('high');
    expect(q.hdr).toBe(false);
    expect(resolveQuality('auto', caps({ hdr: true }), { forceRgba8: true }).tier).toBe('low');
  });

  it('hasHdrColorBuffer is false when float color-buffer extensions are missing', () => {
    expect(
      hasHdrColorBuffer({
        getExtension(name) {
          if (name === 'EXT_color_buffer_half_float' || name === 'EXT_color_buffer_float') {
            return null;
          }
          return {};
        },
      }),
    ).toBe(false);
    expect(
      hasHdrColorBuffer({
        getExtension(name) {
          return name === 'EXT_color_buffer_half_float' ? {} : null;
        },
      }),
    ).toBe(true);
  });

  it('turns persistence off when Reduce Motion is on', () => {
    expect(resolveQuality('high', caps(), { reduceMotion: true }).persistence).toBe(false);
    expect(resolveQuality('low', caps(), { reduceMotion: true }).persistence).toBe(false);
  });

  it('uses 16F when the probe passed, RGBA8 only as a fallback', () => {
    expect(resolveQuality('low', caps({ hdr: true })).hdr).toBe(true);
    expect(resolveQuality('high', caps({ hdr: false })).hdr).toBe(false);
  });

  it('resolves auto from GPU caps', () => {
    expect(pickAutoTier(caps({ hdr: false }))).toBe('low');
    expect(pickAutoTier(caps({ renderer: 'Google SwiftShader' }))).toBe('low');
    expect(pickAutoTier(caps({ renderer: 'ANGLE (Intel, Mesa Intel(R) Iris Xe Graphics)' }))).toBe(
      'medium',
    );
    expect(pickAutoTier(caps({ renderer: 'Apple M1' }))).toBe('high');
    expect(pickAutoTier(caps({ renderer: 'NVIDIA GeForce RTX 4070' }))).toBe('high');
    expect(resolveQuality('auto', caps({ renderer: 'Google SwiftShader' })).tier).toBe('low');
    expect(resolveQuality('auto', caps({ renderer: 'NVIDIA GeForce GTX 1080' })).setting).toBe(
      'auto',
    );
  });

  it('accepts the four settings.graphics.quality tokens', () => {
    expect(isQualitySetting('auto')).toBe(true);
    expect(isQualitySetting('low')).toBe(true);
    expect(isQualitySetting('ultra')).toBe(false);
    expect(isQualitySetting(null)).toBe(false);
  });
});
