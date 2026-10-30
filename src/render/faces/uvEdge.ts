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
import {
  BEAM_DWELL,
  BEAM_DWELL_SIGMA,
  BEAM_FOG_DENSITY,
  BEAM_FOG_START,
  BEAM_SIGMA,
  type BeamStyle,
} from '../lines/BeamBatch';
import beamLineFrag from '../lines/beamLine.frag';
import { DEFAULT_CRAWL_AMP, DEFAULT_CRAWL_SPEED, UV_EDGE_RGB } from './blackIceMath';
import uvEdgeVert from './uvEdge.vert';

export interface UvEdgeStyle extends BeamStyle {
  crawlAmp: number;
  crawlSpeed: number;
}

/**
 * Additive ultraviolet edge material. Pass into `createBeamBatch({ material })`
 * so the crawl rides the same instanced ribbons as M1.1. Colour is #8A2BFF,
 * not a palette slot — black ICE is a rule-breaker.
 */
export function createUvEdgeMaterial(style?: Partial<UvEdgeStyle>): ShaderMaterial {
  const color = new Vector3(UV_EDGE_RGB.r, UV_EDGE_RGB.g, UV_EDGE_RGB.b);
  return new ShaderMaterial({
    name: 'uvEdge',
    glslVersion: GLSL3,
    vertexShader: uvEdgeVert,
    fragmentShader: beamLineFrag,
    uniforms: {
      uResolution: { value: new Vector2(1, 1) },
      uNear: { value: 0.5 },
      uSigma: { value: style?.sigma ?? BEAM_SIGMA },
      uDwell: { value: style?.dwell ?? BEAM_DWELL },
      uDwellSigma: { value: style?.dwellSigma ?? BEAM_DWELL_SIGMA },
      uFogStart: { value: style?.fogStart ?? BEAM_FOG_START },
      uFogDensity: { value: style?.fogDensity ?? BEAM_FOG_DENSITY },
      uTime: { value: 0 },
      uCrawlAmp: { value: style?.crawlAmp ?? DEFAULT_CRAWL_AMP },
      uCrawlSpeed: { value: style?.crawlSpeed ?? DEFAULT_CRAWL_SPEED },
      uUvColor: { value: color },
      logDepthBufFC: { value: 2 / (Math.log(1000 + 1) / Math.LN2) },
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

export function setUvEdgeTime(material: ShaderMaterial, time: number): void {
  material.uniforms.uTime!.value = time;
}

export function setUvEdgeCrawl(material: ShaderMaterial, amp: number, speed?: number): void {
  material.uniforms.uCrawlAmp!.value = amp;
  if (speed !== undefined) material.uniforms.uCrawlSpeed!.value = speed;
}
