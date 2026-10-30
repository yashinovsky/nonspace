import type { Action } from '../../narrative/schema';
import { GATE_WINDOWS } from '../tuning';
import type { SimstimTimeline } from './types';

/** Lab / AC timeline: a short corridor walk with one gate branch. */
export function labSimstimTimeline(): SimstimTimeline {
  return {
    id: 'lab-simstim',
    scene: 'lab:lobby',
    cameraPath: [
      { t: 0, pos: { x: 0, y: 1.55, z: 1.2 }, look: { x: 0, y: 1.45, z: -1 }, bob: 0.018 },
      { t: 4, pos: { x: 0.15, y: 1.55, z: -2.4 }, look: { x: 0.2, y: 1.4, z: -6 }, bob: 0.022 },
      { t: 8, pos: { x: 0.05, y: 1.58, z: -6.2 }, look: { x: 0, y: 1.4, z: -10 }, bob: 0.02 },
      { t: 14, pos: { x: 0, y: 1.55, z: -8.6 }, look: { x: 0, y: 1.45, z: -12 }, bob: 0.016 },
    ],
    figures: [
      {
        id: 'guard',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: 2.1, y: 0, z: -6.2 }, yaw: Math.PI },
          { t: 9, pose: 'wait', pos: { x: 1.6, y: 0, z: -7.4 }, yaw: Math.PI * 0.85 },
        ],
      },
    ],
    lines: [
      { t: 1.2, who: 'molly', text: 'In.' },
      { t: 6.5, who: 'molly', text: 'Door.' },
      { t: 11, who: 'molly', text: 'Now.' },
    ],
    branches: [
      {
        atGate: 'door-1',
        onLate: { holdUntilOpen: true, exposurePerSec: GATE_WINDOWS.exposurePerSec },
      },
    ],
    clockStart: '02:14:07',
  };
}

const none: Action[] = [];

export const LAB_GATE = {
  id: 'door-1',
  iceNode: 'sense-net-door',
  tMeat: 8,
  early: 3,
  late: 2,
  onEarly: none,
  onLate: none,
};
