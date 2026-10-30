import type { ShaderMaterial, Texture } from 'three';
import {
  createFullscreenMaterial,
  createIdentityPass,
  type PostContext,
  type PostPass,
} from './pass';

/**
 * Black ICE composite (plan §8.4, §8.5). Owned by **M1.8**.
 *
 * Replace this file. The stub adds `ctx.bloom` onto `combined` when bloom is
 * present so M1.5 is visible before this pass lands; it ignores the mask.
 * The real pass should `col *= 1.0 - mask * k` after bloom, then add the UV
 * edge glow. Read `ctx.combined`, `ctx.bloom`, `ctx.targets.blackIceMask`.
 */
const ADD_BLOOM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform sampler2D tBloom;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(tInput, vUv).rgb + texture(tBloom, vUv).rgb, 1.0);
}
`;

export function createBlackIceComposite(): PostPass {
  const identity = createIdentityPass('blackIce', 'blackIce');
  let material: ShaderMaterial | null = null;

  return {
    ...identity,
    render(input: Texture, ctx: PostContext) {
      if (!ctx.bloom) return input;
      material ??= createFullscreenMaterial(ADD_BLOOM_FRAG, {
        tInput: { value: input },
        tBloom: { value: ctx.bloom },
      });
      material.uniforms.tInput!.value = input;
      material.uniforms.tBloom!.value = ctx.bloom;
      ctx.blit(material, ctx.targets.post.write);
      ctx.targets.post.swap();
      return ctx.targets.post.read.texture;
    },
    dispose() {
      material?.dispose();
      material = null;
    },
  };
}
