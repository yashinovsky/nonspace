import { describe, expect, it } from 'vitest';
import {
  isQualitySetting,
  pickAutoTier,
  resolveQuality,
  type GpuCaps,
} from '../../src/render/quality';

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
