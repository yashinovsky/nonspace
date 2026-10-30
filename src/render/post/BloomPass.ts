/// <reference types="vite-plugin-glsl/ext" />
import type { ShaderMaterial, WebGLRenderTarget } from 'three';
import { Vector2, Vector3 } from 'three';
import { createColorTarget } from '../targets';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import bloomDownFrag from './shaders/bloomDown.frag';
import bloomUpFrag from './shaders/bloomUp.frag';

/** High-tier dual-filter chain (plan §8.4). Low/Medium use 4/5 of these. */
export const BLOOM_MAX_MIPS = 6;

/** Slightly warm tint on the extra-wide halation mip (plan §8.5). */
export const HALATION_WARM_TINT = { r: 1.06, g: 0.92, b: 0.72 } as const;

export const DEFAULT_BLOOM_INTENSITY = 0.35;
export const DEFAULT_HALATION_WEIGHT = 0.1;
/** Finer-mip contribution while upsampling; keeps energy from exploding. */
export const BLOOM_HIGH_GAIN = 0.45;

/**
 * Wintermute overexpose amount 0..1 → bloom radius 1..2 (plan M1.5 AC).
 * Palette `lerpAllTo` is independent; this is the radius hook that AI later sets
 * with `{ kind: 'overexpose'; amount }` via `pass.radius` or `ctx.bloomRadius`.
 */
export function bloomRadiusForWintermute(amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  return 1 + t;
}

export interface BloomStats {
  mips: number;
  draws: number;
  cpuMs: number;
}

export interface BloomPass extends PostPass {
  /** Dual-filter tent scale. 1 = nominal; Wintermute uses 2. */
  radius: number;
  /** Bloom-only add intensity. */
  intensity: number;
  /** Extra-wide warm mip weight. */
  halationWeight: number;
  readonly stats: BloomStats;
}

/**
 * Dual-filter bloom + halation (plan §8.4, §8.5). Writes the bloom-only
 * texture to `ctx.bloom` and returns `combined` unchanged so M1.8 can add it
 * after the mask. Owns its mip chain via `createColorTarget`.
 */
export function createBloomPass(): BloomPass {
  const down: WebGLRenderTarget[] = [];
  const up: WebGLRenderTarget[] = [];
  let halation: WebGLRenderTarget | null = null;
  let output: WebGLRenderTarget | null = null;
  let allocatedHdr = true;
  let srcW = 1;
  let srcH = 1;

  let downMat: ShaderMaterial | null = null;
  let upMat: ShaderMaterial | null = null;

  const texel = new Vector2();
  const haloTexel = new Vector2();
  const warm = new Vector3(HALATION_WARM_TINT.r, HALATION_WARM_TINT.g, HALATION_WARM_TINT.b);

  const stats: BloomStats = { mips: 0, draws: 0, cpuMs: 0 };

  const pass: BloomPass = {
    name: 'bloom',
    slot: 'bloom',
    radius: 1,
    intensity: DEFAULT_BLOOM_INTENSITY,
    halationWeight: DEFAULT_HALATION_WEIGHT,
    stats,
    resize(width, height, ctx) {
      srcW = Math.max(1, width);
      srcH = Math.max(1, height);
      ensureTargets(ctx.quality.hdr);
      for (let i = 0; i < BLOOM_MAX_MIPS; i++) {
        const [mw, mh] = mipSize(srcW, srcH, i + 1);
        setSizeIfChanged(down[i]!, mw, mh);
        if (i < up.length) setSizeIfChanged(up[i]!, mw, mh);
      }
      const [hw, hh] = mipSize(srcW, srcH, BLOOM_MAX_MIPS + 1);
      setSizeIfChanged(halation!, hw, hh);
      setSizeIfChanged(output!, srcW, srcH);
      // Re-upload immediately so renderer.info().textures does not dip
      // across a resize (WebGLRenderTarget.setSize disposes lazily).
      if (typeof ctx.renderer.initRenderTarget === 'function') {
        for (const rt of down) ctx.renderer.initRenderTarget(rt);
        for (const rt of up) ctx.renderer.initRenderTarget(rt);
        ctx.renderer.initRenderTarget(halation!);
        ctx.renderer.initRenderTarget(output!);
      }
    },
    render(input, ctx: PostContext) {
      if (!output || down.length === 0 || skipGpuBloom(ctx)) {
        ctx.bloom = null;
        return input;
      }
      const mips = clampMips(ctx.quality.bloomMips);
      const radius = ctx.bloomRadius ?? pass.radius;
      const t0 = nowMs();
      let draws = 0;

      const downM = ensureDown();
      const upM = ensureUp();

      // Downsample: Karis only on the HDR source to tame intensity-4 fireflies.
      downM.uniforms.tInput!.value = input;
      downM.uniforms.uTexelSize!.value = texel.set(1 / srcW, 1 / srcH);
      downM.uniforms.uKaris!.value = 1;
      ctx.blit(downM, down[0]!);
      draws++;

      for (let i = 1; i < mips; i++) {
        const src = down[i - 1]!;
        downM.uniforms.tInput!.value = src.texture;
        downM.uniforms.uTexelSize!.value = texel.set(
          1 / Math.max(src.width, 1),
          1 / Math.max(src.height, 1),
        );
        downM.uniforms.uKaris!.value = 0;
        ctx.blit(downM, down[i]!);
        draws++;
      }

      const last = down[mips - 1]!;
      downM.uniforms.tInput!.value = last.texture;
      downM.uniforms.uTexelSize!.value = texel.set(
        1 / Math.max(last.width, 1),
        1 / Math.max(last.height, 1),
      );
      downM.uniforms.uKaris!.value = 0;
      ctx.blit(downM, halation!);
      draws++;

      // Upsample from the coarsest dual-filter mip, folding in finer downs.
      upM.uniforms.uHalationWeight!.value = 0;
      upM.uniforms.uIntensity!.value = 1;
      let low: WebGLRenderTarget = last;
      for (let i = mips - 2; i >= 0; i--) {
        const dest = up[i]!;
        const high = down[i]!;
        upM.uniforms.tLow!.value = low.texture;
        upM.uniforms.tHigh!.value = high.texture;
        upM.uniforms.uTexelSize!.value = texel.set(
          1 / Math.max(low.width, 1),
          1 / Math.max(low.height, 1),
        );
        upM.uniforms.uSampleScale!.value = radius;
        upM.uniforms.uAddHigh!.value = 1;
        upM.uniforms.uHighGain!.value = BLOOM_HIGH_GAIN;
        ctx.blit(upM, dest);
        draws++;
        low = dest;
      }

      haloTexel.set(1 / Math.max(halation!.width, 1), 1 / Math.max(halation!.height, 1));
      upM.uniforms.tLow!.value = low.texture;
      upM.uniforms.tHalation!.value = halation!.texture;
      upM.uniforms.uTexelSize!.value = texel.set(
        1 / Math.max(low.width, 1),
        1 / Math.max(low.height, 1),
      );
      upM.uniforms.uHalationTexel!.value = haloTexel;
      upM.uniforms.uSampleScale!.value = radius;
      upM.uniforms.uAddHigh!.value = 0;
      upM.uniforms.uIntensity!.value = pass.intensity;
      upM.uniforms.uHalationWeight!.value = pass.halationWeight;
      upM.uniforms.uWarmTint!.value = warm;
      ctx.blit(upM, output);
      draws++;

      stats.mips = mips;
      stats.draws = draws;
      stats.cpuMs = nowMs() - t0;
      ctx.bloom = output.texture;
      return input;
    },
    dispose() {
      disposeTargets();
      downMat?.dispose();
      upMat?.dispose();
      downMat = null;
      upMat = null;
    },
  };

  function ensureDown(): ShaderMaterial {
    downMat ??= createFullscreenMaterial(bloomDownFrag, {
      tInput: { value: null },
      uTexelSize: { value: new Vector2(1, 1) },
      uKaris: { value: 0 },
    });
    return downMat;
  }

  function ensureUp(): ShaderMaterial {
    upMat ??= createFullscreenMaterial(bloomUpFrag, {
      tLow: { value: null },
      tHigh: { value: null },
      tHalation: { value: null },
      uTexelSize: { value: new Vector2(1, 1) },
      uHalationTexel: { value: new Vector2(1, 1) },
      uSampleScale: { value: 1 },
      uAddHigh: { value: 1 },
      uHighGain: { value: BLOOM_HIGH_GAIN },
      uIntensity: { value: 1 },
      uHalationWeight: { value: 0 },
      uWarmTint: { value: warm.clone() },
    });
    return upMat;
  }

  function ensureTargets(hdr: boolean): void {
    if (down.length === BLOOM_MAX_MIPS && up.length === BLOOM_MAX_MIPS - 1 && allocatedHdr === hdr)
      return;
    disposeTargets();
    allocatedHdr = hdr;
    for (let i = 0; i < BLOOM_MAX_MIPS; i++) {
      down.push(createColorTarget(1, 1, { hdr, depth: false }));
    }
    // One fewer upsample than downs: the coarsest mip is the upsample source.
    for (let i = 0; i < BLOOM_MAX_MIPS - 1; i++) {
      up.push(createColorTarget(1, 1, { hdr, depth: false }));
    }
    halation = createColorTarget(1, 1, { hdr, depth: false });
    output = createColorTarget(1, 1, { hdr, depth: false });
  }

  function disposeTargets(): void {
    for (const rt of down) rt.dispose();
    for (const rt of up) rt.dispose();
    down.length = 0;
    up.length = 0;
    halation?.dispose();
    output?.dispose();
    halation = null;
    output = null;
  }

  return pass;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|gdi generic/i;

/**
 * Low is identity (same as persistence-off). Software GL (SwiftShader) also
 * skips: 13 extra 16F blits blow the throttled 60 Hz loop and make sibling
 * e2e canvas screenshots wait forever for a stable frame. Medium/High run
 * the dual-filter on real GPUs. Unit tests use a fake renderer (no GL) so
 * they still exercise the mip chain.
 */
function skipGpuBloom(ctx: PostContext): boolean {
  if (ctx.quality.tier === 'low') return true;
  const gl = ctx.renderer.getContext?.() as WebGLRenderingContext | undefined;
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    return SOFTWARE_GPU.test(name);
  } catch {
    return false;
  }
}

function setSizeIfChanged(rt: WebGLRenderTarget, width: number, height: number): void {
  if (rt.width === width && rt.height === height) return;
  rt.setSize(width, height);
}

function clampMips(n: number): number {
  return Math.min(BLOOM_MAX_MIPS, Math.max(1, Math.floor(n) || BLOOM_MAX_MIPS));
}

function mipSize(width: number, height: number, level: number): [number, number] {
  return [Math.max(1, width >> level), Math.max(1, height >> level)];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
