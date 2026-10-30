import { describe, expect, it } from 'vitest';
import type { Texture, WebGLRenderTarget } from 'three';
import {
  applyMask,
  clamp01,
  crawlOffset,
  DEFAULT_MASK_STRENGTH,
  tendrilCoverage,
  UV_EDGE_HEX,
  UV_EDGE_RGB,
} from '../../src/render/faces/blackIceMath';
import blackIceFrag from '../../src/render/faces/blackIce.frag';
import uvEdgeVert from '../../src/render/faces/uvEdge.vert';
import {
  asBlackIceComposite,
  createBlackIceComposite,
  isBlackIceComposite,
} from '../../src/render/post/BlackIceComposite';
import type { PostContext } from '../../src/render/post/pass';
import { bindPingPong } from '../../src/render/targets';
import compositeFrag from '../../src/render/post/shaders/blackIceComposite.frag';
import { octahedronLineSet } from '../../src/render/faces/blackIce';
import { createIdentityPass } from '../../src/render/post/pass';

const tex = (id: string): Texture => ({ uuid: id }) as unknown as Texture;

function fakeRt(id: string): WebGLRenderTarget {
  const rt = {
    uuid: id,
    width: 1,
    height: 1,
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

describe('black ICE mask math', () => {
  it('eats a bright construct and its bloom to true black', () => {
    const hot = { r: 4, g: 2.8, b: 0 };
    const bloom = { r: 1.2, g: 0.8, b: 0.15 };
    const out = applyMask(hot, bloom, 1, DEFAULT_MASK_STRENGTH);
    expect(out.r).toBe(0);
    expect(out.g).toBe(0);
    expect(out.b).toBe(0);
  });

  it('leaves uncovered pixels including bloom', () => {
    const col = { r: 0.4, g: 0.2, b: 0.05 };
    const bloom = { r: 0.3, g: 0.1, b: 0 };
    const out = applyMask(col, bloom, 0, 1);
    expect(out.r).toBeCloseTo(0.7);
    expect(out.g).toBeCloseTo(0.3);
    expect(out.b).toBeCloseTo(0.05);
  });

  it('scales with k so a partial mask still subtracts', () => {
    const out = applyMask({ r: 1, g: 1, b: 1 }, null, 1, 0.5);
    expect(out.r).toBeCloseTo(0.5);
  });
});

describe('grip tendrils', () => {
  it('are off at grip 0 and miss the screen centre at grip 1', () => {
    expect(tendrilCoverage(0.5, 0.5, 1.2, 0)).toBe(0);
    expect(tendrilCoverage(0.5, 0.5, 1.2, 1)).toBeLessThan(0.08);
  });

  it('grow inward from the screen edge', () => {
    let edge = 0;
    for (let y = 0; y <= 1; y += 0.02) {
      edge = Math.max(edge, tendrilCoverage(0.02, y, 0.4, 1));
    }
    const mid = tendrilCoverage(0.5, 0.5, 0.4, 1);
    expect(edge).toBeGreaterThan(0.2);
    expect(edge).toBeGreaterThan(mid);
  });
});

describe('UV crawl offset', () => {
  it('is zero at amp 0 and moves endpoints over time', () => {
    expect(crawlOffset(1, 0, 0, 1, 0)).toEqual({ x: 0, y: 0, z: 0 });
    const a = crawlOffset(0.4, 0.8, -0.2, 0.0, 0.04);
    const b = crawlOffset(0.4, 0.8, -0.2, 1.7, 0.04);
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(dist).toBeGreaterThan(1e-4);
    expect(Math.hypot(a.x, a.y, a.z)).toBeLessThan(0.05);
  });
});

describe('shaders', () => {
  it('blackIce.frag writes coverage and log depth', () => {
    expect(blackIceFrag).toContain('uCoverage');
    expect(blackIceFrag).toContain('gl_FragDepth');
    expect(blackIceFrag).toContain('logDepthBufFC');
  });

  it('composite subtracts mask after bloom and re-adds UV', () => {
    expect(compositeFrag).toContain('1.0 - mask * uStrength');
    expect(compositeFrag).toContain('tBloom');
    expect(compositeFrag).toContain('tendrilCoverage');
    expect(compositeFrag).toContain('uUvColor');
    expect(compositeFrag).toContain('fwidth(mask)');
  });

  it('uvEdge.vert crawls with the CPU twin', () => {
    expect(uvEdgeVert).toContain('crawlOffset');
    expect(uvEdgeVert).toContain('uCrawlAmp');
    expect(uvEdgeVert).toContain('uUvColor');
  });

  it('uses the §5.3 ultraviolet', () => {
    expect(UV_EDGE_HEX).toBe(0x8a2bff);
    expect(UV_EDGE_RGB.b).toBe(1);
    expect(UV_EDGE_RGB.r).toBeGreaterThan(UV_EDGE_RGB.g);
  });
});

describe('BlackIceComposite pass', () => {
  it('is identity without bloom, mask, or grip (no WebGL)', () => {
    const pass = createBlackIceComposite();
    const input = tex('scene');
    expect(pass.render(input, fakeCtx({ hdr: input, combined: input }))).toBe(input);
    expect(isBlackIceComposite(pass)).toBe(true);
    expect(asBlackIceComposite(pass)).toBe(pass);
    pass.dispose();
  });

  it('is identity on default boot even when the mask RT exists', () => {
    const pass = createBlackIceComposite();
    const input = tex('scene');
    const postA = fakeRt('postA');
    const postB = fakeRt('postB');
    (postA as { texture: Texture }).texture = tex('postA-tex');
    (postB as { texture: Texture }).texture = tex('postB-tex');
    const mask = fakeRt('mask');
    (mask as { texture: Texture }).texture = tex('mask-tex');
    let blits = 0;
    const ctx = fakeCtx({
      hdr: input,
      combined: input,
      blackIceDrawn: false,
      targets: {
        post: bindPingPong(postA, postB),
        blackIceMask: mask,
      } as PostContext['targets'],
      blit: () => {
        blits += 1;
      },
    });
    expect(pass.render(input, ctx)).toBe(input);
    expect(blits).toBe(0);
    pass.dispose();
  });

  it('does not treat an identity stub as the real pass', () => {
    expect(isBlackIceComposite(createIdentityPass('blackIce', 'blackIce'))).toBe(false);
  });

  it('octahedron edges are 12 unique segments', () => {
    const set = octahedronLineSet();
    expect(set.color.length).toBe(12);
    expect(set.flags?.[0]).toBeTruthy();
  });
});

describe('clamp01', () => {
  it('clamps', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });
});
