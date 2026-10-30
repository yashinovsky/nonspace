/// <reference types="vite-plugin-glsl/ext" />
import { Vector2, type ShaderMaterial, type Texture } from 'three';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import vectorCrtFrag from './shaders/vectorCrt.frag';
import { flickerAmplitude, VECTOR_CRT_DEFAULTS, type VectorCrtParams } from './vectorCrt';

export interface VectorCrtPass extends PostPass {
  readonly params: VectorCrtParams;
  /** Last flicker amplitude sent to the shader (0 when Reduce flashing). */
  effectiveFlicker: number;
}

export function isVectorCrtPass(pass: PostPass): pass is VectorCrtPass {
  return pass.slot === 'crt' && pass.kind === 'vector' && 'effectiveFlicker' in pass;
}

/**
 * Vector CRT composite (plan §8.4, §8.5, M1.6). Layers barrel, beam jitter,
 * load-tied flicker, vignette, glass and grain in front of the M1.5
 * Reinhard + desaturate-to-white tonemap (`tonemapReinhardWhite` in
 * `vectorCrt.frag`, matching `shaders/tonemap.frag`). Sets
 * `ctx.encoded = 'ldr'` so FinalComposite does not Reinhard twice.
 *
 * Each effect is individually toggleable via `params.enable*`. Flicker
 * amplitude is 0 when `ctx.reduceFlashing` is on. Empty samples stay
 * RGB (0,0,0) — no raster lift.
 */
export function createVectorCrtPass(): VectorCrtPass {
  const params: VectorCrtParams = { ...VECTOR_CRT_DEFAULTS };
  let material: ShaderMaterial | null = null;
  const resolution = new Vector2(1, 1);

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(vectorCrtFrag, {
      tInput: { value: null },
      uExposure: { value: 1 },
      uResolution: { value: resolution },
      uTime: { value: 0 },
      uBarrel: { value: params.barrel },
      uJitter: { value: params.jitter },
      uFlicker: { value: 0 },
      uVignette: { value: params.vignette },
      uGlass: { value: params.glass },
      uGrain: { value: params.grain },
    });
    return material;
  };

  const pass: VectorCrtPass = {
    name: 'vectorCrt',
    slot: 'crt',
    kind: 'vector',
    params,
    effectiveFlicker: 0,
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const dest = ctx.targets.post.write;
      if (!dest?.texture) {
        ctx.encoded = 'ldr';
        pass.effectiveFlicker = flickerAmplitude(
          ctx.vectorLoad,
          ctx.reduceFlashing,
          params.flicker,
          params.enableFlicker,
        );
        return input;
      }

      const flicker = flickerAmplitude(
        ctx.vectorLoad,
        ctx.reduceFlashing,
        params.flicker,
        params.enableFlicker,
      );
      pass.effectiveFlicker = flicker;

      const w = Math.max(1, dest.width || ctx.targets.width || 1);
      const h = Math.max(1, dest.height || ctx.targets.height || 1);
      resolution.set(w, h);

      const mat = ensure();
      const u = mat.uniforms;
      u.tInput!.value = input;
      u.uExposure!.value = ctx.exposure;
      u.uTime!.value = ctx.time;
      u.uBarrel!.value = params.enableBarrel ? params.barrel : 0;
      u.uJitter!.value = params.enableJitter ? params.jitter : 0;
      u.uFlicker!.value = flicker;
      u.uVignette!.value = params.enableVignette ? params.vignette : 0;
      u.uGlass!.value = params.enableGlass ? params.glass : 0;
      u.uGrain!.value = params.enableGrain ? params.grain : 0;

      ctx.blit(mat, dest);
      ctx.targets.post.swap();
      ctx.encoded = 'ldr';
      return ctx.targets.post.read.texture ?? input;
    },
    dispose() {
      material?.dispose();
      material = null;
    },
  };
  return pass;
}

export function asVectorCrtPass(pass: PostPass): VectorCrtPass {
  if (!isVectorCrtPass(pass)) throw new Error('expected VectorCrtPass');
  return pass;
}
