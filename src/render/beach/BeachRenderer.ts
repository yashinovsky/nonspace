import { Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { createBlitter, createFullscreenMaterial, type Blitter } from '../post/pass';
import { createColorTarget } from '../targets';
import beachFrag from './beach.frag';
import { BOY, EXIT, figureY, FOV_DEG, LINDA, lookVectors, MAX_MARCH } from './world';
import type { WalkPose } from './walk';

const UPSCALE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = texture(tInput, vUv);
}
`;

export interface BeachView {
  pose: WalkPose;
  sunX: number;
  sunY: number;
  sunZ: number;
  time: number;
  reveal: number;
  stay: number;
  maxSteps: number;
  hdr: boolean;
}

export interface BeachRenderer {
  render(three: WebGLRenderer, target: WebGLRenderTarget, view: BeachView): void;
  resize(width: number, height: number, hdr: boolean): void;
  dispose(): void;
}

export function createBeachRenderer(): BeachRenderer {
  const blitter: Blitter = createBlitter();
  const camPos = new Vector3();
  const camRight = new Vector3();
  const camUp = new Vector3();
  const camForward = new Vector3();
  const sunDir = new Vector3();
  const linda = new Vector3(LINDA.x, figureY(LINDA.x, LINDA.z), LINDA.z);
  const boy = new Vector3(BOY.x, figureY(BOY.x, BOY.z), BOY.z);
  const fwd = { x: 0, y: 0, z: -1 };
  const right = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };

  const marchMat = createFullscreenMaterial(beachFrag, {
    uCamPos: { value: camPos },
    uCamRight: { value: camRight },
    uCamUp: { value: camUp },
    uCamForward: { value: camForward },
    uSunDir: { value: sunDir },
    uLindaPos: { value: linda },
    uBoyPos: { value: boy },
    uExit: { value: { x: EXIT.x, y: EXIT.z } },
    uAspect: { value: 1 },
    uTanHalfFov: { value: Math.tan((FOV_DEG * 0.5 * Math.PI) / 180) },
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uStay: { value: 0 },
    uMaxSteps: { value: MAX_MARCH },
  });
  const upscaleMat = createFullscreenMaterial(UPSCALE_FRAG, {
    tInput: { value: null },
  });

  let half = createColorTarget(1, 1, { hdr: true, depth: false });
  let halfW = 1;
  let halfH = 1;
  let hdr = true;

  const api: BeachRenderer = {
    resize(width, height, nextHdr) {
      const w = Math.max(1, Math.ceil(width / 2));
      const h = Math.max(1, Math.ceil(height / 2));
      if (w === halfW && h === halfH && nextHdr === hdr) return;
      halfW = w;
      halfH = h;
      if (nextHdr !== hdr) {
        half.dispose();
        hdr = nextHdr;
        half = createColorTarget(w, h, { hdr, depth: false });
      } else {
        half.setSize(w, h);
      }
    },
    render(three, target, view) {
      const tw = target.width;
      const th = target.height;
      api.resize(tw, th, view.hdr);
      lookVectors(view.pose.yaw, view.pose.pitch, fwd, right, up);
      camPos.set(view.pose.x, view.pose.y, view.pose.z);
      camRight.set(right.x, right.y, right.z);
      camUp.set(up.x, up.y, up.z);
      camForward.set(fwd.x, fwd.y, fwd.z);
      sunDir.set(view.sunX, view.sunY, view.sunZ);
      const u = marchMat.uniforms;
      u.uAspect!.value = tw / Math.max(th, 1);
      u.uTime!.value = view.time;
      u.uReveal!.value = view.reveal;
      u.uStay!.value = view.stay;
      u.uMaxSteps!.value = view.maxSteps;
      blitter.blit(three, marchMat, half);
      upscaleMat.uniforms.tInput!.value = half.texture;
      blitter.blit(three, upscaleMat, target);
    },
    dispose() {
      half.dispose();
      marchMat.dispose();
      upscaleMat.dispose();
      blitter.dispose();
    },
  };
  return api;
}
