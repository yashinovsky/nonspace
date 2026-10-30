import type { ShaderMaterial, Texture } from 'three';
import {
  createFullscreenMaterial,
  IDENTITY_CRT_COLLAPSE,
  isIdentityCrtCollapse,
  type PostContext,
  type PostPass,
} from './pass';

const IDENTITY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform float uTonemap;
uniform float uExposure;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(tInput, vUv).rgb * uExposure;
  if (uTonemap > 0.5) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 mapped = c / (1.0 + max(lum, 0.0));
    float hot = max(lum - 1.0, 0.0);
    mapped = mix(mapped, vec3(1.0), clamp(hot / 3.0, 0.0, 1.0));
    c = mapped;
  }
  fragColor = vec4(c, 1.0);
}
`;

const COLLAPSE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform float uTonemap;
uniform float uExposure;
uniform vec2 uCollapse;
uniform float uCollapseGlow;
uniform float uCollapseFade;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 scale = max(uCollapse, vec2(1e-4));
  vec2 uv = (vUv - 0.5) / scale + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec3 c = texture(tInput, uv).rgb * uExposure * inside;
  if (uTonemap > 0.5) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 mapped = c / (1.0 + max(lum, 0.0));
    float hot = max(lum - 1.0, 0.0);
    mapped = mix(mapped, vec3(1.0), clamp(hot / 3.0, 0.0, 1.0));
    c = mapped;
  }
  vec2 d = (vUv - 0.5) / max(scale, vec2(0.01));
  float phosphor = exp(-dot(d, d) * 2.8) * uCollapseGlow;
  c += vec3(0.82, 0.90, 1.0) * phosphor;
  c *= uCollapseFade;
  fragColor = vec4(c, 1.0);
}
`;

/**
 * Last slot: blit to the backbuffer. M0.4 is a pass-through plus Reinhard
 * tonemap / desaturate-to-white (plan §5.3, §8.5) so the HDR test cube is
 * visible. Later:
 * - M1.6 writes LDR and sets `ctx.encoded = 'ldr'` → this skip-tonemaps
 * - M3.2 overlays `ctx.targets.hud`
 * - M2.7 CRT collapse via `ctx.crtCollapse` (identity blit when unset / identity)
 * - M2.5 / jack-in streak, Wintermute exposure (`ctx.exposure`)
 *
 * Do not move tonemap into a sibling pass file from here — VectorCrtPass is
 * the owner once it lands.
 *
 * Collapse shader is compiled only when squash is non-identity (same idea as
 * BlackIceComposite skipping the mask blit when no ICE was drawn). Default
 * boot / sector lab / SwiftShader keep the original pass-through ALU.
 */
export function createFinalComposite(): PostPass {
  let identity: ShaderMaterial | null = null;
  let collapse: ShaderMaterial | null = null;

  const ensureIdentity = (): ShaderMaterial => {
    identity ??= createFullscreenMaterial(IDENTITY_FRAG, {
      tInput: { value: null },
      uTonemap: { value: 1 },
      uExposure: { value: 1 },
    });
    return identity;
  };

  const ensureCollapse = (): ShaderMaterial => {
    collapse ??= createFullscreenMaterial(COLLAPSE_FRAG, {
      tInput: { value: null },
      uTonemap: { value: 1 },
      uExposure: { value: 1 },
      uCollapse: { value: { x: 1, y: 1 } },
      uCollapseGlow: { value: 0 },
      uCollapseFade: { value: 1 },
    });
    return collapse;
  };

  return {
    name: 'final',
    slot: 'final',
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const state = ctx.crtCollapse ?? IDENTITY_CRT_COLLAPSE;
      if (isIdentityCrtCollapse(state)) {
        const mat = ensureIdentity();
        mat.uniforms.tInput!.value = input;
        mat.uniforms.uTonemap!.value = ctx.encoded === 'hdr' ? 1 : 0;
        mat.uniforms.uExposure!.value = ctx.exposure;
        ctx.blit(mat, null);
        return input;
      }
      const mat = ensureCollapse();
      mat.uniforms.tInput!.value = input;
      mat.uniforms.uTonemap!.value = ctx.encoded === 'hdr' ? 1 : 0;
      mat.uniforms.uExposure!.value = ctx.exposure;
      const uv = mat.uniforms.uCollapse!.value as { x: number; y: number };
      uv.x = state.scaleX;
      uv.y = state.scaleY;
      mat.uniforms.uCollapseGlow!.value = state.glow;
      mat.uniforms.uCollapseFade!.value = state.fade;
      ctx.blit(mat, null);
      return input;
    },
    dispose() {
      identity?.dispose();
      collapse?.dispose();
      identity = null;
      collapse = null;
    },
  };
}
