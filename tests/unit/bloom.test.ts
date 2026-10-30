import { describe, expect, it } from 'vitest';
import type { Texture, WebGLRenderTarget } from 'three';
import {
  BLOOM_MAX_MIPS,
  bloomRadiusForWintermute,
  createBloomPass,
  HALATION_WARM_TINT,
} from '../../src/render/post/BloomPass';
import { createVectorCrtPass } from '../../src/render/post/VectorCrtPass';
import { chroma, tonemapReinhardWhite } from '../../src/render/post/tonemap';
import type { PostContext } from '../../src/render/post/pass';
import { bindPingPong } from '../../src/render/targets';
import { hexToRgb } from '../../src/render/palette';
import bloomDown from '../../src/render/post/shaders/bloomDown.frag';
import bloomUp from '../../src/render/post/shaders/bloomUp.frag';
import tonemapFrag from '../../src/render/post/shaders/tonemap.frag';

const tex = (id: string): Texture => ({ uuid: id }) as unknown as Texture;

function fakeRt(id: string): WebGLRenderTarget {
  const rt = {
    uuid: id,
    texture: tex(`${id}-tex`),
    width: 1,
    height: 1,
    setSize(w: number, h: number) {
      rt.width = w;
      rt.height = h;
    },
    dispose() {},
  };
  return rt as unknown as WebGLRenderTarget;
}

function fakeCtx(over: Partial<PostContext> = {}): PostContext {
  const a = fakeRt('postA');
  const b = fakeRt('postB');
  const hdr = tex('hdr');
  return {
    renderer: {} as PostContext['renderer'],
    targets: { post: bindPingPong(a, b), width: 1920, height: 1080 } as PostContext['targets'],
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
    mode: 'matrix',
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

describe('tonemap (M1.5)', () => {
  it('desaturates intensity-4 amber toward white vs nominal 1.0', () => {
    const amber = hexToRgb(0xffb000);
    const hot = { r: amber.r * 4, g: amber.g * 4, b: amber.b * 4 };
    const mappedHot = tonemapReinhardWhite(hot);
    const mappedNom = tonemapReinhardWhite(amber);
    expect(chroma(mappedHot)).toBeLessThan(chroma(mappedNom));
    expect(mappedHot.b).toBeGreaterThan(mappedNom.b);
    expect(Math.min(mappedHot.r, mappedHot.g, mappedHot.b)).toBeGreaterThan(0.4);
  });

  it('leaves black at zero (true black floor)', () => {
    expect(tonemapReinhardWhite({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('Wintermute bloom radius hook', () => {
  it('is 1 at rest and 2 at full overexpose', () => {
    expect(bloomRadiusForWintermute(0)).toBe(1);
    expect(bloomRadiusForWintermute(1)).toBe(2);
    expect(bloomRadiusForWintermute(0.5)).toBeCloseTo(1.5);
    expect(bloomRadiusForWintermute(-1)).toBe(1);
    expect(bloomRadiusForWintermute(4)).toBe(2);
  });
});

describe('BloomPass contract', () => {
  it('returns combined unchanged and writes ctx.bloom after resize', () => {
    const pass = createBloomPass();
    const input = tex('combined');
    const blits: Array<string | 'null'> = [];
    const ctx = fakeCtx({
      blit(_mat, target) {
        blits.push(target ? ((target as unknown as { uuid: string }).uuid ?? 'rt') : 'null');
      },
    });
    expect(pass.render(input, ctx)).toBe(input);
    expect(ctx.bloom).toBeNull();

    pass.resize(1920, 1080, ctx);
    const out = pass.render(input, ctx);
    expect(out).toBe(input);
    expect(ctx.bloom).not.toBeNull();
    expect(pass.stats.mips).toBe(6);
    // 6 down + 1 halation + 5 upsample + 1 composite
    expect(pass.stats.draws).toBe(13);
    expect(blits).toHaveLength(13);
    pass.dispose();
  });

  it('uses quality.bloomMips (Medium = 5) and ctx.bloomRadius', () => {
    const pass = createBloomPass();
    const input = tex('combined');
    const ctx = fakeCtx({
      bloomRadius: 2,
      quality: {
        setting: 'medium',
        tier: 'medium',
        baseScale: 1,
        persistence: true,
        bloomMips: 5,
        latticeRadius: 160,
        maxLineSegments: 80_000,
        maxPoints: 40_000,
        allowRgba8Fallback: false,
        hdr: true,
      },
    });
    pass.resize(1280, 720, ctx);
    pass.render(input, ctx);
    expect(pass.stats.mips).toBe(5);
    // 5 down + 1 halation + 4 upsample + 1 composite
    expect(pass.stats.draws).toBe(11);
    pass.dispose();
  });

  it('is identity on Low (no mips, combined unchanged)', () => {
    const pass = createBloomPass();
    const input = tex('combined');
    const ctx = fakeCtx({
      quality: {
        setting: 'low',
        tier: 'low',
        baseScale: 2 / 3,
        persistence: false,
        bloomMips: 4,
        latticeRadius: 120,
        maxLineSegments: 40_000,
        maxPoints: 20_000,
        allowRgba8Fallback: true,
        hdr: true,
      },
    });
    pass.resize(1280, 720, ctx);
    expect(pass.render(input, ctx)).toBe(input);
    expect(ctx.bloom).toBeNull();
    expect(pass.stats.draws).toBe(0);
    pass.dispose();
  });

  it('resize is stable (no extra targets on a second call)', () => {
    const pass = createBloomPass();
    const ctx = fakeCtx();
    pass.resize(800, 600, ctx);
    const first = pass.stats;
    pass.resize(1920, 1080, ctx);
    pass.resize(800, 600, ctx);
    expect(first).toBe(pass.stats);
    pass.dispose();
  });
});

describe('VectorCrtPass tonemap stub', () => {
  it('marks encoded ldr and writes through the post ping-pong', () => {
    const pass = createVectorCrtPass();
    const input = tex('hdr-in');
    let blitTarget: unknown = null;
    const ctx = fakeCtx({
      blit(_mat, target) {
        blitTarget = target;
      },
    });
    const out = pass.render(input, ctx);
    expect(ctx.encoded).toBe('ldr');
    expect(out).not.toBe(input);
    expect(blitTarget).toBe(ctx.targets.post.read);
    pass.dispose();
  });
});

describe('bloom / tonemap shaders', () => {
  it('are the CoD dual-filter kernels plus a warm halation composite', () => {
    expect(BLOOM_MAX_MIPS).toBe(6);
    expect(bloomDown).toContain('0.125');
    expect(bloomDown).toContain('uKaris');
    expect(bloomUp).toContain('1.0 / 16.0');
    expect(bloomUp).toContain('uSampleScale');
    expect(bloomUp).toContain('uWarmTint');
    expect(bloomUp).toContain('uSampleScale * 2.0');
    expect(tonemapFrag).toContain('tonemapReinhardWhite');
    expect(HALATION_WARM_TINT.r).toBeGreaterThan(HALATION_WARM_TINT.b);
  });
});
