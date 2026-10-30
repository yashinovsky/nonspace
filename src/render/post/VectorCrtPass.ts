/// <reference types="vite-plugin-glsl/ext" />
import type { ShaderMaterial, Texture } from 'three';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import tonemapFrag from './shaders/tonemap.frag';

/**
 * Vector CRT (plan §8.4, §8.5). CRT effects (barrel, jitter, flicker,
 * vignette, glass, grain, true black) are **M1.6**. This stub is the M1.5
 * tonemap: Reinhard on luminance + desaturate-to-white, then
 * `ctx.encoded = 'ldr'` so FinalComposite does not Reinhard twice.
 *
 * M1.6 should keep the tonemap (see `shaders/tonemap.frag`) and layer CRT
 * sampling in front of it. Toggleable effects belong in the debug GUI.
 */
export function createVectorCrtPass(): PostPass {
  let material: ShaderMaterial | null = null;

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(tonemapFrag, {
      tInput: { value: null },
      uExposure: { value: 1 },
    });
    return material;
  };

  return {
    name: 'vectorCrt',
    slot: 'crt',
    kind: 'vector',
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const dest = ctx.targets.post.write;
      if (!dest) {
        ctx.encoded = 'ldr';
        return input;
      }
      const mat = ensure();
      mat.uniforms.tInput!.value = input;
      mat.uniforms.uExposure!.value = ctx.exposure;
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
}
