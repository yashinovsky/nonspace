/**
 * First-person camera driven by FlightController (plan §3.3).
 *
 * Visual-only roll (banking) and speed FOV live on the interpolated pose; the
 * sim itself has no roll input. Uses a plain THREE.PerspectiveCamera so this
 * task does not depend on the M0.4 Renderer service.
 */

import { PerspectiveCamera } from 'three';
import { FLIGHT_DEFAULTS, wrapAngle, type FlightController } from './FlightController';

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  /** Copy the interpolated pose onto the camera. `alpha` is the loop leftover. */
  apply(flight: FlightController, alpha: number): void;
  setAspect(aspect: number): void;
  dispose(): void;
}

export interface CameraRigOptions {
  camera?: PerspectiveCamera;
  aspect?: number;
  near?: number;
  far?: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function createCameraRig(opts: CameraRigOptions = {}): CameraRig {
  const aspect = opts.aspect ?? 1;
  const cam =
    opts.camera ??
    new PerspectiveCamera(FLIGHT_DEFAULTS.fovBase, aspect, opts.near ?? 0.1, opts.far ?? 50_000);
  cam.rotation.order = 'YXZ';
  let lastFov = cam.fov;
  let lastAspect = cam.aspect;

  const rig: CameraRig = {
    camera: cam,
    apply(flight, alpha) {
      const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      const a = flight.prev;
      const b = flight.pose;
      cam.position.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
      const pitch = lerp(a.pitch, b.pitch, t);
      const yaw = lerpAngle(a.yaw, b.yaw, t);
      const bank = lerp(a.bank, b.bank, t);
      cam.rotation.set(pitch, yaw, bank);
      const fov = lerp(a.fov, b.fov, t);
      if (fov !== lastFov) {
        cam.fov = fov;
        lastFov = fov;
        cam.updateProjectionMatrix();
      }
    },
    setAspect(next) {
      if (next > 0 && next !== lastAspect) {
        cam.aspect = next;
        lastAspect = next;
        cam.updateProjectionMatrix();
      }
    },
    dispose() {
      cam.removeFromParent();
    },
  };
  return rig;
}
