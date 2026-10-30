import type { ShaderMaterial, Texture } from 'three';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import finalCompositeFrag from './shaders/finalComposite.frag';

/**
 * Last slot: blit to the backbuffer. M0.4 is a pass-through plus Reinhard
 * tonemap / desaturate-to-white (plan §5.3, §8.5) so the HDR test cube is
 * visible. Later:
 * - M1.6 writes LDR and sets `ctx.encoded = 'ldr'` → this skip-tonemaps
 * - M3.2 overlays `ctx.targets.hud`
 * - M2.5 / jack-in add collapse, streak, Wintermute exposure (`ctx.exposure`)
 *
 * Do not move tonemap into a sibling pass file from here — VectorCrtPass is
 * the owner once it lands.
 */
export function createFinalComposite(): PostPass {
  let material: ShaderMaterial | null = null;

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(finalCompositeFrag, {
      tInput: { value: null },
      uTonemap: { value: 1 },
      uExposure: { value: 1 },
    });
    return material;
  };

  return {
    name: 'final',
    slot: 'final',
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const mat = ensure();
      mat.uniforms.tInput!.value = input;
      mat.uniforms.uTonemap!.value = ctx.encoded === 'hdr' ? 1 : 0;
      mat.uniforms.uExposure!.value = ctx.exposure;
      ctx.blit(mat, null);
      return input;
    },
    dispose() {
      material?.dispose();
      material = null;
    },
  };
}
