import { describe, expect, it } from 'vitest';
import type { Texture, WebGLRenderTarget } from 'three';
import { createIdentityPass, type PostContext } from '../../src/render/post/PostChain';
import {
  asVectorCrtPass,
  createVectorCrtPass,
  isVectorCrtPass,
} from '../../src/render/post/VectorCrtPass';
import {
  barrelUv,
  flickerAmplitude,
  modulatePhosphor,
  VECTOR_BARREL_K,
  VECTOR_CRT_DEFAULTS,
  VECTOR_FLICKER_AMP,
  VECTOR_JITTER_PX,
} from '../../src/render/post/vectorCrt';
import { bindPingPong } from '../../src/render/targets';
import { chroma, tonemapReinhardWhite } from '../../src/render/post/tonemap';
import { hexToRgb } from '../../src/render/palette';
import tonemapFrag from '../../src/render/post/shaders/tonemap.frag';
import vectorCrtFrag from '../../src/render/post/shaders/vectorCrt.frag';

const tex = (id: string): Texture => ({ uuid: id }) as unknown as Texture;

function fakeRt(id: string): WebGLRenderTarget {
  const rt = {
    uuid: id,
    texture: tex(`${id}-tex`),
    width: 1920,
    height: 1080,
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

describe('barrel', () => {
  it('is identity at k = 0 and pushes corners outside at 0.015', () => {
    expect(barrelUv(0.5, 0.5, VECTOR_BARREL_K)).toEqual({ x: 0.5, y: 0.5 });
    expect(barrelUv(0.25, 0.4, 0)).toEqual({ x: 0.25, y: 0.4 });
    const corner = barrelUv(0, 0, VECTOR_BARREL_K);
    expect(corner.x).toBeLessThan(0);
    expect(corner.y).toBeLessThan(0);
  });
});

describe('flicker', () => {
  it('is 0 when Reduce flashing is on, even at full load', () => {
    expect(flickerAmplitude(1, true, VECTOR_FLICKER_AMP, true)).toBe(0);
    expect(flickerAmplitude(1, false, VECTOR_FLICKER_AMP, false)).toBe(0);
    expect(flickerAmplitude(0, false, VECTOR_FLICKER_AMP, true)).toBe(0);
  });

  it('scales with load and never exceeds 3%', () => {
    expect(flickerAmplitude(1, false)).toBeCloseTo(VECTOR_FLICKER_AMP);
    expect(flickerAmplitude(0.5, false)).toBeCloseTo(VECTOR_FLICKER_AMP * 0.5);
    expect(flickerAmplitude(1, false, 0.5)).toBe(VECTOR_FLICKER_AMP);
  });
});

describe('true black floor', () => {
  it('does not lift RGB 0 under grain / glass / flicker multipliers', () => {
    expect(modulatePhosphor({ r: 0, g: 0, b: 0 }, 1.4)).toEqual({ r: 0, g: 0, b: 0 });
    expect(tonemapReinhardWhite({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('tonemap is kept', () => {
  it('vectorCrt.frag still Reinhard-desaturates like tonemap.frag', () => {
    expect(vectorCrtFrag).toContain('tonemapReinhardWhite');
    expect(tonemapFrag).toContain('tonemapReinhardWhite');
    expect(VECTOR_JITTER_PX).toBe(0.25);
    expect(VECTOR_CRT_DEFAULTS.barrel).toBe(VECTOR_BARREL_K);
    const amber = hexToRgb(0xffb000);
    const hot = { r: amber.r * 4, g: amber.g * 4, b: amber.b * 4 };
    expect(chroma(tonemapReinhardWhite(hot))).toBeLessThan(chroma(tonemapReinhardWhite(amber)));
  });
});

describe('VectorCrtPass', () => {
  it('is a vector CRT slot with toggleable params', () => {
    const pass = asVectorCrtPass(createVectorCrtPass());
    expect(pass.name).toBe('vectorCrt');
    expect(pass.kind).toBe('vector');
    expect(pass.slot).toBe('crt');
    expect(isVectorCrtPass(pass)).toBe(true);
    expect(pass.params.enableBarrel).toBe(true);
    expect(pass.params.jitter).toBe(VECTOR_JITTER_PX);
    pass.dispose();
  });

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

  it('zeros flicker uniforms when Reduce flashing is on', () => {
    const pass = asVectorCrtPass(createVectorCrtPass());
    let flicker = -1;
    const ctx = fakeCtx({
      reduceFlashing: true,
      vectorLoad: 1,
      blit(material) {
        flicker = (material as unknown as { uniforms: { uFlicker: { value: number } } }).uniforms
          .uFlicker.value;
      },
    });
    pass.render(tex('in'), ctx);
    expect(flicker).toBe(0);
    expect(pass.effectiveFlicker).toBe(0);
    pass.dispose();
  });

  it('sends load-scaled flicker when Reduce flashing is off', () => {
    const pass = asVectorCrtPass(createVectorCrtPass());
    let flicker = -1;
    const ctx = fakeCtx({
      reduceFlashing: false,
      vectorLoad: 0.5,
      blit(material) {
        flicker = (material as unknown as { uniforms: { uFlicker: { value: number } } }).uniforms
          .uFlicker.value;
      },
    });
    pass.render(tex('in'), ctx);
    expect(flicker).toBeCloseTo(VECTOR_FLICKER_AMP * 0.5);
    expect(pass.effectiveFlicker).toBeCloseTo(VECTOR_FLICKER_AMP * 0.5);
    pass.params.enableFlicker = false;
    pass.render(tex('in'), ctx);
    expect(pass.effectiveFlicker).toBe(0);
    pass.dispose();
  });

  it('zeros each effect uniform when its toggle is off', () => {
    const pass = asVectorCrtPass(createVectorCrtPass());
    const seen: Record<string, number> = {};
    pass.params.enableBarrel = false;
    pass.params.enableJitter = false;
    pass.params.enableVignette = false;
    pass.params.enableGlass = false;
    pass.params.enableGrain = false;
    const ctx = fakeCtx({
      reduceFlashing: false,
      vectorLoad: 1,
      blit(material) {
        const u = (
          material as unknown as {
            uniforms: Record<string, { value: number }>;
          }
        ).uniforms;
        seen.barrel = u.uBarrel.value;
        seen.jitter = u.uJitter.value;
        seen.vignette = u.uVignette.value;
        seen.glass = u.uGlass.value;
        seen.grain = u.uGrain.value;
      },
    });
    pass.render(tex('in'), ctx);
    expect(seen).toEqual({ barrel: 0, jitter: 0, vignette: 0, glass: 0, grain: 0 });
    pass.dispose();
  });

  it('is a no-op on stub targets without a texture', () => {
    const pass = createVectorCrtPass();
    const input = tex('in');
    const a = { uuid: 'postA' } as unknown as WebGLRenderTarget;
    const b = { uuid: 'postB' } as unknown as WebGLRenderTarget;
    const ctx = fakeCtx({
      targets: { post: bindPingPong(a, b) } as PostContext['targets'],
    });
    expect(pass.render(input, ctx)).toBe(input);
    expect(ctx.encoded).toBe('ldr');
    pass.dispose();
  });

  it('is not confused with the identity helper', () => {
    expect(isVectorCrtPass(createIdentityPass('vectorCrt', 'crt', 'vector'))).toBe(false);
  });
});
