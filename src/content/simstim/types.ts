import type { Vec3 } from '../../core/math/vec3';

/**
 * Simstim timeline (plan §9.6). Driven by meat time, which keeps running when
 * not flipped; a late gate holds the timeline in a "wait" segment that accrues
 * exposure until the gate opens. Playback is M6.1's.
 */
export interface SimstimTimeline {
  id: string;
  /** glb path */
  scene: string;
  cameraPath: Array<{ t: number; pos: Vec3; look: Vec3; bob?: number }>;
  figures: Array<{
    id: string;
    rig: string;
    keys: Array<{ t: number; pose: string; pos: Vec3; yaw: number }>;
  }>;
  lines: Array<{ t: number; who: 'molly' | string; text: string }>;
  branches: Array<{
    atGate: string;
    onLate: { holdUntilOpen: boolean; exposurePerSec: number; injectSegment?: string };
  }>;
  /** Chip clock at t = 0, e.g. '02:14:07'. */
  clockStart: string;
}
