import { describe, expect, it } from 'vitest';
import { fillSmpteRgba, smpteRgb, SMPTE_BARS } from '../../src/debug/smpteCard';
import {
  asRasterCrtPass,
  createRasterCrtPass,
  isRasterCrtPass,
} from '../../src/render/post/RasterCrtPass';
import {
  countFlashes,
  ntscChromaBleed,
  rasterTransitionAt,
  rgbToYiq,
  sampleTransitionLuma,
  yiqToRgb,
  NTSC_WIDTH,
  RASTER_TRANSITION_DURATION,
} from '../../src/render/post/rasterCrt';
import { createIdentityPass, type PostContext } from '../../src/render/post/PostChain';
import { bindPingPong } from '../../src/render/targets';
import type { Texture, WebGLRenderTarget } from 'three';

const tex = (id: string): Texture => ({ uuid: id }) as unknown as Texture;

function fakeCtx(over: Partial<PostContext> = {}): PostContext {
  const a = { uuid: 'postA' } as unknown as WebGLRenderTarget;
  const b = { uuid: 'postB' } as unknown as WebGLRenderTarget;
  const hdr = tex('hdr');
  return {
    renderer: {} as PostContext['renderer'],
    targets: { post: bindPingPong(a, b) } as PostContext['targets'],
    blit: () => {},
    quality: {
      setting: 'high',
      tier: 'high',
      baseScale: 1,
      persistence: true,
      bloomMips: 6,
      latticeRadius: 200,
      maxLineSegments: 150_000,
      maxPoints: 60_000,
      allowRgba8Fallback: false,
      hdr: true,
    },
    scale: 1,
    dt: 1 / 60,
    time: 0,
    mode: 'simstim',
    angularVelocity: 0,
    reduceFlashing: true,
    reduceMotion: false,
    hdr,
    combined: hdr,
    bloom: null,
    encoded: 'hdr',
    exposure: 1,
    vectorLoad: 0,
    ...over,
  };
}

describe('YIQ round-trip', () => {
  it('round-trips primary and gray samples', () => {
    const samples: Array<[number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
      [191 / 255, 0, 191 / 255],
    ];
    for (const [r, g, b] of samples) {
      const yiq = rgbToYiq(r, g, b);
      const rgb = yiqToRgb(yiq.y, yiq.i, yiq.q);
      expect(rgb.r).toBeCloseTo(r, 2);
      expect(rgb.g).toBeCloseTo(g, 2);
      expect(rgb.b).toBeCloseTo(b, 2);
    }
  });
});

describe('NTSC chroma bleed', () => {
  it('spreads I/Q farther than Y across a red|cyan edge', () => {
    const row = new Float32Array(NTSC_WIDTH * 3);
    const split = 160;
    for (let x = 0; x < NTSC_WIDTH; x++) {
      if (x < split) {
        row[x * 3] = 0.75;
        row[x * 3 + 1] = 0;
        row[x * 3 + 2] = 0;
      } else {
        row[x * 3] = 0;
        row[x * 3 + 1] = 0.75;
        row[x * 3 + 2] = 0.75;
      }
    }
    const out = ntscChromaBleed(row);
    const luma = (arr: Float32Array, x: number): number =>
      0.299 * arr[x * 3]! + 0.587 * arr[x * 3 + 1]! + 0.114 * arr[x * 3 + 2]!;

    // 2 px into cyan: Y's 1-px kernel is already all-cyan, I/Q's 4-px kernel
    // still sees red, so R leaks farther than luma.
    const x = split + 2;
    expect(row[x * 3]).toBe(0);
    expect(out[x * 3]!).toBeGreaterThan(0.03);
    expect(Math.abs(luma(out, x) - luma(row, x))).toBeLessThan(0.02);

    expect(out[20 * 3]!).toBeGreaterThan(0.6);
    expect(out[300 * 3 + 2]!).toBeGreaterThan(0.6);
  });
});

describe('simstim-flip transition', () => {
  it('lasts 0.3 s and is idle outside the window', () => {
    expect(RASTER_TRANSITION_DURATION).toBe(0.3);
    expect(rasterTransitionAt(-0.01).hHold).toBe(0);
    expect(rasterTransitionAt(0.3).hHold).toBe(0);
    const mid = rasterTransitionAt(0.05);
    expect(mid.hHold).toBeGreaterThan(0.5);
    expect(mid.staticAmount).toBeGreaterThan(0);
    expect(mid.tracking).toBeGreaterThan(0);
  });

  it('has at most one flash in 1 s (under the 3/s cap) at low contrast', () => {
    const samples = sampleTransitionLuma(0.3, 60, false);
    expect(Math.max(...samples)).toBeLessThan(0.08);
    expect(countFlashes(samples, 0.01)).toBeLessThanOrEqual(1);
    expect(countFlashes(samples, 0.01)).toBeLessThanOrEqual(3);

    const reduced = sampleTransitionLuma(0.3, 60, true);
    expect(Math.max(...reduced)).toBeLessThan(Math.max(...samples) + 1e-6);
    expect(Math.max(...reduced)).toBeLessThan(0.03);
  });
});

describe('SMPTE card', () => {
  it('places 75% bars across the top third and text-free RGB at known x', () => {
    expect(smpteRgb(10, 20)).toEqual(SMPTE_BARS[0]);
    expect(smpteRgb(50, 20)).toEqual(SMPTE_BARS[1]);
    expect(smpteRgb(300, 20)).toEqual(SMPTE_BARS[6]);
    const data = new Uint8ClampedArray(320 * 240 * 4);
    fillSmpteRgba(data);
    // Yellow bar around x=50, y=40.
    const i = (40 * 320 + 50) * 4;
    expect(data[i]).toBe(191);
    expect(data[i + 1]).toBe(191);
    expect(data[i + 2]).toBe(0);
  });
});

describe('RasterCrtPass', () => {
  it('is a raster CRT slot with transition params', () => {
    const pass = asRasterCrtPass(createRasterCrtPass());
    expect(pass.name).toBe('rasterCrt');
    expect(pass.kind).toBe('raster');
    expect(pass.slot).toBe('crt');
    expect(isRasterCrtPass(pass)).toBe(true);
    expect(pass.params.hHold).toBe(0);
    expect(pass.params.chromaPx).toBe(4);
    expect(pass.params.lumaPx).toBe(1);
    pass.playTransition();
    expect(pass.transition.playing).toBe(true);
    expect(pass.transition.duration).toBe(0.3);
    pass.stopTransition();
    expect(pass.transition.playing).toBe(false);
    pass.dispose();
  });

  it('marks encoded ldr and is a no-op on stub targets', () => {
    const pass = createRasterCrtPass();
    const input = tex('in');
    const ctx = fakeCtx();
    expect(pass.render(input, ctx)).toBe(input);
    expect(ctx.encoded).toBe('ldr');
    pass.dispose();
  });

  it('is not confused with the identity helper', () => {
    expect(isRasterCrtPass(createIdentityPass('rasterCrt', 'crt', 'raster'))).toBe(false);
  });
});
