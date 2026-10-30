import { describe, expect, it } from 'vitest';
import type { Texture, WebGLRenderTarget } from 'three';
import {
  createPersistencePass,
  DEFAULT_SMEAR_THRESHOLD,
  persistDecayExponent,
  persistKeep,
  PERSIST_KEEP,
  type PersistencePass,
} from '../../src/render/post/PersistencePass';
import persistenceFrag from '../../src/render/post/shaders/persistence.frag';
import { bindPingPong } from '../../src/render/targets';
import type { PostContext } from '../../src/render/post/pass';

const tex = (id: string): Texture => ({ uuid: id }) as unknown as Texture;

function rt(id: string): WebGLRenderTarget {
  return { uuid: id, texture: tex(id) } as unknown as WebGLRenderTarget;
}

function quality(persistence: boolean): PostContext['quality'] {
  return {
    setting: persistence ? 'high' : 'low',
    tier: persistence ? 'high' : 'low',
    baseScale: persistence ? 1 : 2 / 3,
    persistence,
    bloomMips: persistence ? 6 : 4,
    latticeRadius: persistence ? 200 : 120,
    maxLineSegments: persistence ? 150_000 : 40_000,
    maxPoints: persistence ? 60_000 : 20_000,
    allowRgba8Fallback: !persistence,
    hdr: true,
  };
}

function fakeCtx(over: Partial<PostContext> = {}): PostContext {
  const persist = bindPingPong(rt('persistA'), rt('persistB'));
  const post = bindPingPong(rt('postA'), rt('postB'));
  const hdr = tex('hdr');
  return {
    renderer: {} as PostContext['renderer'],
    targets: { post, persist } as PostContext['targets'],
    blit: () => {},
    quality: quality(true),
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

function remainingAtFps(fps: number, seconds: number, omega: number, scale: number): number {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  const keep = persistKeep(persistDecayExponent(dt, omega, scale))[0]!;
  let energy = 1;
  for (let i = 0; i < frames; i++) energy *= keep;
  return energy;
}

describe('persistence.frag', () => {
  it('encodes the §8.5 P7 per-channel decay and AFTERGLOW shift', () => {
    expect(persistenceFrag).toContain('pow(vec3(0.90, 0.93, 0.78)');
    expect(persistenceFrag).toContain('uAfterglow');
    expect(persistenceFrag).toContain('uShift');
    expect(persistenceFrag).toContain('max(current, shifted)');
  });
});

describe('persistDecayExponent', () => {
  it('is frame-rate independent: trail energy after 0.5 s matches at 30/60/144 fps within 10%', () => {
    const at30 = remainingAtFps(30, 0.5, 0, 1);
    const at60 = remainingAtFps(60, 0.5, 0, 1);
    const at144 = remainingAtFps(144, 0.5, 0, 1);
    expect(Math.abs(at30 - at60) / at60).toBeLessThan(0.1);
    expect(Math.abs(at144 - at60) / at60).toBeLessThan(0.1);
    expect(at60).toBeGreaterThan(0);
    expect(at60).toBeLessThan(1);
  });

  it('decays blue fastest so trails shift off blue-white', () => {
    const keep = persistKeep(persistDecayExponent(1 / 60, 0, 1));
    expect(keep[2]).toBeLessThan(keep[0]);
    expect(keep[0]).toBeLessThan(keep[1]);
    expect(keep[0]).toBeCloseTo(PERSIST_KEEP[0], 8);
  });

  it('strengthens decay above the angular-velocity anti-smear threshold', () => {
    const still = persistDecayExponent(1 / 60, 0, 1);
    const slow = persistDecayExponent(1 / 60, DEFAULT_SMEAR_THRESHOLD, 1);
    const fast = persistDecayExponent(1 / 60, DEFAULT_SMEAR_THRESHOLD + 2, 1);
    expect(slow).toBeCloseTo(still, 8);
    expect(fast).toBeGreaterThan(still * 2);
    expect(remainingAtFps(60, 0.25, DEFAULT_SMEAR_THRESHOLD + 2, 1)).toBeLessThan(
      remainingAtFps(60, 0.25, 0, 1) * 0.5,
    );
  });

  it('decayScale 0 freezes trails and <1 lengthens them', () => {
    expect(persistDecayExponent(1 / 60, 0, 0)).toBe(0);
    expect(persistKeep(0)).toEqual([1, 1, 1]);
    const slow = remainingAtFps(60, 0.4, 0, 0.4);
    const nominal = remainingAtFps(60, 0.4, 0, 1);
    expect(slow).toBeGreaterThan(nominal);
  });
});

describe('PersistencePass', () => {
  it('returns input when persistence is off, Reduce Motion is on, or buffers are missing', () => {
    const pass = createPersistencePass();
    const input = tex('scene');
    expect(pass.render(input, fakeCtx({ quality: quality(false) }))).toBe(input);
    expect(pass.render(input, fakeCtx({ reduceMotion: true }))).toBe(input);
    const noBuf = fakeCtx();
    (noBuf.targets as { persist?: unknown }).persist = undefined;
    expect(pass.render(input, noBuf)).toBe(input);
    pass.dispose();
  });

  it('ping-pongs persist A/B and does not return the scene texture while active', () => {
    const pass = createPersistencePass();
    const input = tex('scene');
    const ctx = fakeCtx();
    const first = pass.render(input, ctx);
    expect(first).not.toBe(input);
    expect((first as unknown as { uuid: string }).uuid).toBe('persistB');
    const second = pass.render(input, ctx);
    expect((second as unknown as { uuid: string }).uuid).toBe('persistA');
    pass.dispose();
  });

  it('exposes decayScale / shift for jump streak and Freeze without touching PostChain', () => {
    const pass: PersistencePass = createPersistencePass();
    expect(pass.slot).toBe('persistence');
    expect(pass.decayScale).toBe(1);
    pass.decayScale = 0.35;
    pass.shift = 1;
    expect(pass.decayScale).toBe(0.35);
    expect(pass.shift).toBe(1);
    pass.dispose();
  });
});
