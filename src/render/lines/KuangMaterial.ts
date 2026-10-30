/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  CustomBlending,
  GLSL3,
  OneFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Palette } from '../palette';
import { TA_RGB } from './kuangMath';
import {
  BEAM_DWELL,
  BEAM_DWELL_SIGMA,
  BEAM_FOG_DENSITY,
  BEAM_FOG_START,
  BEAM_SIGMA,
  type BeamStyle,
} from './BeamBatch';
import kuangVert from './kuang.vert';
import kuangFrag from './kuang.frag';

/**
 * BeamLine variant for Kuang ribs (plan §8.5). Same ribbon uniforms as
 * `createBeamMaterial` so `createBeamBatch({ material })` can drive it.
 */
export function createKuangMaterial(palette: Palette, style?: Partial<BeamStyle>): ShaderMaterial {
  const resolved: BeamStyle = {
    sigma: style?.sigma ?? BEAM_SIGMA,
    dwell: style?.dwell ?? BEAM_DWELL,
    dwellSigma: style?.dwellSigma ?? BEAM_DWELL_SIGMA,
    fogStart: style?.fogStart ?? BEAM_FOG_START,
    fogDensity: style?.fogDensity ?? BEAM_FOG_DENSITY,
  };
  return new ShaderMaterial({
    name: 'kuang',
    glslVersion: GLSL3,
    vertexShader: kuangVert,
    fragmentShader: kuangFrag,
    uniforms: {
      uPalette: palette.uniform,
      uResolution: { value: new Vector2(1, 1) },
      uNear: { value: 0.5 },
      uSigma: { value: resolved.sigma },
      uDwell: { value: resolved.dwell },
      uDwellSigma: { value: resolved.dwellSigma },
      uFogStart: { value: resolved.fogStart },
      uFogDensity: { value: resolved.fogDensity },
      logDepthBufFC: { value: 2 / (Math.log(1000 + 1) / Math.LN2) },
      uTime: { value: 0 },
      uMimic: { value: 0 },
      uTa: { value: new Vector3(TA_RGB.r, TA_RGB.g, TA_RGB.b) },
    },
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    fog: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });
}

export function setKuangUniforms(material: ShaderMaterial, time: number, mimic: number): void {
  material.uniforms.uTime!.value = time;
  material.uniforms.uMimic!.value = mimic < 0 ? 0 : mimic > 1 ? 1 : mimic;
}
