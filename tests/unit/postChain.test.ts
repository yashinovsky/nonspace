import { describe, expect, it } from 'vitest';
import type { Texture } from 'three';
import { createBloomPass } from '../../src/render/post/BloomPass';
import { createBlackIceComposite } from '../../src/render/post/BlackIceComposite';
import { createFinalComposite } from '../../src/render/post/FinalComposite';
import {
  createIdentityPass,
  createPostChain,
  slotsFor,
  type PostContext,
  type PostPass,
} from '../../src/render/post/PostChain';
import { createPersistencePass } from '../../src/render/post/PersistencePass';
import { createRasterCrtPass } from '../../src/render/post/RasterCrtPass';
import { createVectorCrtPass } from '../../src/render/post/VectorCrtPass';
import { bindPingPong } from '../../src/render/targets';
import type { WebGLRenderTarget } from 'three';

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

describe('PostChain', () => {
  it('runs matrix slots in the §8.4 order and swaps CRT by mode', () => {
    expect(slotsFor('matrix')).toEqual(['persistence', 'bloom', 'blackIce', 'crt', 'final']);
    expect(slotsFor('simstim')).toEqual(['bloom', 'crt', 'final']);
    expect(slotsFor('interlude')).toEqual(['bloom', 'crt', 'final']);
    expect(slotsFor('beach')).toEqual(['final']);
  });

  it('wires each M1 slot to its own file and leaves identity passes as no-ops', () => {
    const chain = createPostChain();
    expect(chain.getPass('persistence').name).toBe('persistence');
    expect(chain.getPass('bloom').name).toBe('bloom');
    expect(chain.getPass('blackIce').name).toBe('blackIce');
    expect(chain.vectorCrt.name).toBe('vectorCrt');
    expect(chain.vectorCrt.kind).toBe('vector');
    expect(chain.rasterCrt.name).toBe('rasterCrt');
    expect(chain.rasterCrt.kind).toBe('raster');
    expect(chain.getPass('final').name).toBe('final');

    const input = tex('scene');
    const ctx = fakeCtx({ hdr: input, combined: input });
    expect(createPersistencePass().render(input, ctx)).toBe(input);
    expect(createVectorCrtPass().render(input, ctx)).toBe(input);
    expect(createRasterCrtPass().render(input, ctx)).toBe(input);

    const bloom = createBloomPass();
    expect(bloom.render(input, ctx)).toBe(input);
    expect(ctx.bloom).toBeNull();

    expect(createBlackIceComposite().render(input, ctx)).toBe(input);
    chain.dispose();
  });

  it('lets a slot be replaced without touching sibling files', () => {
    const chain = createPostChain();
    const input = tex('scene');
    const marked = tex('persist-out');
    const persist: PostPass = {
      ...createIdentityPass('persistence', 'persistence'),
      render() {
        return marked;
      },
    };
    chain.setPass(persist);

    const seen: string[] = [];
    chain.setPass({
      ...createIdentityPass('final', 'final'),
      render(texIn) {
        seen.push((texIn as unknown as { uuid: string }).uuid);
        return texIn;
      },
    });

    const ctx = fakeCtx({ hdr: input, combined: input });
    chain.render(input, ctx);
    expect(ctx.combined).toBe(marked);
    expect(seen).toEqual(['persist-out']);
    chain.dispose();
  });

  it('skips vector CRT on beach and uses raster CRT on simstim', () => {
    const chain = createPostChain();
    const input = tex('scene');
    const hits: string[] = [];
    const tag = (pass: PostPass): PostPass => ({
      ...pass,
      render(texIn) {
        hits.push(pass.name);
        return texIn;
      },
    });
    chain.setCrt('vector', tag(createVectorCrtPass()));
    chain.setCrt('raster', tag(createRasterCrtPass()));
    chain.setPass(tag(createIdentityPass('final', 'final')));

    chain.render(input, fakeCtx({ mode: 'beach' }));
    expect(hits).toEqual(['final']);

    hits.length = 0;
    chain.render(input, fakeCtx({ mode: 'simstim' }));
    expect(hits).toEqual(['rasterCrt', 'final']);

    hits.length = 0;
    chain.render(input, fakeCtx({ mode: 'matrix' }));
    expect(hits).toContain('vectorCrt');
    expect(hits).not.toContain('rasterCrt');
    chain.dispose();
  });

  it('ping-pong swap does not allocate', () => {
    const a = { id: 'a' } as unknown as WebGLRenderTarget;
    const b = { id: 'b' } as unknown as WebGLRenderTarget;
    const pp = bindPingPong(a, b);
    expect(pp.read).toBe(a);
    expect(pp.write).toBe(b);
    pp.swap();
    expect(pp.read).toBe(b);
    expect(pp.write).toBe(a);
  });
});

describe('FinalComposite contract', () => {
  it('tonemaps while encoded is hdr and skips after a CRT marks ldr', () => {
    const pass = createFinalComposite();
    const input = tex('in');
    let tonemap = -1;
    const ctx = fakeCtx({
      encoded: 'hdr',
      blit: (material) => {
        const u = (material as unknown as { uniforms: { uTonemap: { value: number } } }).uniforms;
        tonemap = u.uTonemap.value;
      },
    });
    pass.render(input, ctx);
    expect(tonemap).toBe(1);

    ctx.encoded = 'ldr';
    pass.render(input, ctx);
    expect(tonemap).toBe(0);
    pass.dispose();
  });
});
