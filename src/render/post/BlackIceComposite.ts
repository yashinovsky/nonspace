/// <reference types="vite-plugin-glsl/ext" />
import { Vector3, type ShaderMaterial, type Texture } from 'three';
import { DEFAULT_EDGE_INTENSITY, DEFAULT_MASK_STRENGTH, UV_EDGE_RGB } from '../faces/blackIceMath';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import blackIceCompositeFrag from './shaders/blackIceComposite.frag';

/**
 * Black ICE composite (plan §8.4, §8.5, M1.8). Adds `ctx.bloom` onto combined,
 * multiplies by `1 - mask * strength` so the solid eats glow, then re-adds a
 * crawling ultraviolet silhouette. `grip` 0..1 grows screen-edge tendrils.
 *
 * Skip (return `input`) when there is no bloom, grip is 0, and no ICE was
 * drawn this frame so default-boot / SwiftShader stay identity. Does not
 * edit PostChain or siblings.
 */
export interface BlackIceComposite extends PostPass {
  /** `k` in `col *= 1.0 - mask * k`. */
  strength: number;
  /** Mask-silhouette UV add. */
  edgeIntensity: number;
  /** Screen-edge tendril overlay (grip), 0..1. */
  grip: number;
}

export function isBlackIceComposite(pass: PostPass): pass is BlackIceComposite {
  return pass.slot === 'blackIce' && 'grip' in pass && 'strength' in pass;
}

export function asBlackIceComposite(pass: PostPass): BlackIceComposite {
  if (!isBlackIceComposite(pass)) throw new Error('expected BlackIceComposite');
  return pass;
}

export function createBlackIceComposite(): BlackIceComposite {
  let material: ShaderMaterial | null = null;
  const uv = new Vector3(UV_EDGE_RGB.r, UV_EDGE_RGB.g, UV_EDGE_RGB.b);

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(blackIceCompositeFrag, {
      tInput: { value: null },
      tBloom: { value: null },
      tMask: { value: null },
      uHasBloom: { value: 0 },
      uHasMask: { value: 0 },
      uStrength: { value: DEFAULT_MASK_STRENGTH },
      uEdgeIntensity: { value: DEFAULT_EDGE_INTENSITY },
      uTime: { value: 0 },
      uGrip: { value: 0 },
      uReduceMotion: { value: 0 },
      uUvColor: { value: uv },
    });
    return material;
  };

  const pass: BlackIceComposite = {
    name: 'blackIce',
    slot: 'blackIce',
    strength: DEFAULT_MASK_STRENGTH,
    edgeIntensity: DEFAULT_EDGE_INTENSITY,
    grip: 0,
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const dest = ctx.targets.post?.write;
      const maskTex = ctx.targets.blackIceMask?.texture ?? null;
      const bloom = ctx.bloom;
      const iceDrawn = !!ctx.blackIceDrawn;
      const grip = Math.min(1, Math.max(0, pass.grip));
      if (!dest?.texture) return input;
      // Mask RT always exists; skip unless bloom, grip overlay, or ICE wrote.
      if (!bloom && grip <= 1e-4 && !iceDrawn) return input;

      const mat = ensure();
      const u = mat.uniforms;
      u.tInput!.value = input;
      u.tBloom!.value = bloom ?? input;
      u.tMask!.value = maskTex ?? input;
      u.uHasBloom!.value = bloom ? 1 : 0;
      u.uHasMask!.value = iceDrawn && maskTex ? 1 : 0;
      u.uStrength!.value = pass.strength;
      u.uEdgeIntensity!.value = pass.edgeIntensity;
      u.uTime!.value = ctx.time;
      u.uGrip!.value = grip;
      u.uReduceMotion!.value = ctx.reduceMotion ? 1 : 0;
      ctx.blit(mat, dest);
      ctx.targets.post.swap();
      return ctx.targets.post.read.texture ?? input;
    },
    dispose() {
      material?.dispose();
      material = null;
    },
  };
  return pass;
}
