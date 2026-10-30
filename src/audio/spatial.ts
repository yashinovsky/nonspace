import type { Vec3 } from '../core/math/vec3';

export interface PannerConfig {
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
}

/** Distances are matrix units (constructs sit on the order of tens to thousands). */
export const DEFAULT_PANNER: PannerConfig = {
  refDistance: 80,
  maxDistance: 6000,
  rolloffFactor: 1,
};

export function createHrtfPanner(
  ctx: AudioContext,
  pos: Vec3,
  cfg: PannerConfig = DEFAULT_PANNER,
): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = cfg.refDistance;
  p.maxDistance = cfg.maxDistance;
  p.rolloffFactor = cfg.rolloffFactor;
  p.coneInnerAngle = 360;
  p.coneOuterAngle = 360;
  setPannerPosition(p, pos);
  return p;
}

export function setPannerPosition(panner: PannerNode, pos: Vec3): void {
  if (panner.positionX) {
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    return;
  }
  panner.setPosition(pos.x, pos.y, pos.z);
}

/**
 * Web Audio listener pose. Three.js cameras look down −Z with +Y up; pass that
 * through so motifs sit in the same space as the renderer.
 */
export function setListenerPose(listener: AudioListener, pos: Vec3, forward: Vec3, up: Vec3): void {
  if (listener.positionX) {
    listener.positionX.value = pos.x;
    listener.positionY.value = pos.y;
    listener.positionZ.value = pos.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
    return;
  }
  listener.setPosition(pos.x, pos.y, pos.z);
  listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
}
