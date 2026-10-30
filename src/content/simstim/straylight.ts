import type { Action } from '../../narrative/schema';
import type { GateDef } from '../../simstim/Gates';
import { GATE_WINDOWS } from '../tuning';
import type { SimstimTimeline } from './types';

/** M6.3 Straylight villa. Shared procedural scene; two timelines (M5 / M7). */
export const STRAYLIGHT_SCENE = 'straylight';
export const STRAYLIGHT_M5_ID = 'straylight-m5';
export const STRAYLIGHT_M7_ID = 'straylight-m7';
/** Stair collapse. M7.8 retimes to book-meat. */
export const STRAYLIGHT_INJURY_AT = 8;
/** 3Jane's three-note stub, shown in the feed line. Campaign typing is M7.7. */
export const STRAYLIGHT_WORD = 'to whom';

const none: Action[] = [];

/** M5 Phase D: hall arch, stair (injury), gallery. */
export const STRAYLIGHT_M5_GATES: GateDef[] = [
  {
    id: 'hall-arch',
    iceNode: 'straylight-hall',
    tMeat: 3,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
  {
    id: 'stair-gate',
    iceNode: 'straylight-stair',
    tMeat: 8,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
  {
    id: 'gallery-door',
    iceNode: 'straylight-gallery',
    tMeat: 13,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
];

/** M7 word scene: head-room seal, then the sung word. */
export const STRAYLIGHT_M7_GATES: GateDef[] = [
  {
    id: 'head-seal',
    iceNode: 'straylight-head',
    tMeat: 4,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
  {
    id: 'word-window',
    iceNode: 'straylight-word',
    tMeat: 8,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
];

const hold = (gates: GateDef[]): SimstimTimeline['branches'] =>
  gates.map((g) => ({
    atGate: g.id,
    onLate: { holdUntilOpen: true, exposurePerSec: GATE_WINDOWS.exposurePerSec },
  }));

/**
 * M5 Phase D walk: hall → stairwell (leg collapses) → gallery. 3Jane unhides
 * at the far arch. Lines are invented stubs — campaign copy is M7.8.
 */
export function straylightM5Timeline(): SimstimTimeline {
  return {
    id: STRAYLIGHT_M5_ID,
    scene: STRAYLIGHT_SCENE,
    cameraPath: [
      { t: 0, pos: { x: 0.05, y: 1.52, z: 3.2 }, look: { x: 0, y: 1.55, z: -9.6 }, bob: 0.014 },
      { t: 2.2, pos: { x: 0.04, y: 1.52, z: -1.2 }, look: { x: 0, y: 1.5, z: -9.6 }, bob: 0.016 },
      { t: 4.0, pos: { x: 0.2, y: 1.56, z: -8.2 }, look: { x: 1.3, y: 2.0, z: -14 }, bob: 0.02 },
      {
        t: 6.2,
        pos: { x: 1.45, y: 2.32, z: -13.0 },
        look: { x: 1.5, y: 2.55, z: -16 },
        bob: 0.022,
      },
      { t: 7.9, pos: { x: 1.4, y: 2.48, z: -13.8 }, look: { x: 1.2, y: 1.5, z: -14.4 }, bob: 0.03 },
      { t: 8.5, pos: { x: 1.05, y: 0.82, z: -13.2 }, look: { x: 1.0, y: 0.15, z: -14 }, bob: 0.04 },
      { t: 10.4, pos: { x: 0.25, y: 1.22, z: -16.6 }, look: { x: 0, y: 1.1, z: -22 }, bob: 0.028 },
      {
        t: 12.8,
        pos: { x: 0.1, y: 1.44, z: -22.4 },
        look: { x: 0.35, y: 1.32, z: -28 },
        bob: 0.018,
      },
      {
        t: 15.6,
        pos: { x: 0.2, y: 1.5, z: -27.2 },
        look: { x: 1.15, y: 1.42, z: -30.4 },
        bob: 0.012,
      },
      { t: 18, pos: { x: 0.12, y: 1.48, z: -28.0 }, look: { x: 1.05, y: 1.45, z: -31 }, bob: 0.01 },
    ],
    figures: [
      {
        id: 'hideo',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: -1.7, y: 0, z: -17.4 }, yaw: 0.4 },
          { t: 11, pose: 'wait', pos: { x: -1.5, y: 0, z: -18.2 }, yaw: 0.15 },
        ],
      },
      {
        id: 'riviera',
        rig: 'mannequin',
        keys: [{ t: 0, pose: 'stand', pos: { x: 1.85, y: 0, z: -24.6 }, yaw: -0.6 }],
      },
      {
        id: 'jane',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'hidden', pos: { x: 1.2, y: 0, z: -30.4 }, yaw: Math.PI },
          { t: 14.8, pose: 'hidden', pos: { x: 1.2, y: 0, z: -30.4 }, yaw: Math.PI },
          { t: 15.0, pose: 'stand', pos: { x: 1.2, y: 0, z: -30.4 }, yaw: Math.PI },
          { t: 17.5, pose: 'wait', pos: { x: 1.15, y: 0, z: -29.8 }, yaw: Math.PI * 0.92 },
        ],
      },
    ],
    lines: [
      { t: 0.8, who: 'molly', text: "I'm in." },
      { t: 3.1, who: 'molly', text: 'Hall arch.' },
      { t: 6.0, who: 'molly', text: 'Stairs.' },
      { t: 8.2, who: 'molly', text: "Leg's gone." },
      { t: 12.4, who: 'molly', text: 'Riviera.' },
      { t: 15.4, who: 'molly', text: '3Jane.' },
    ],
    branches: hold(STRAYLIGHT_M5_GATES),
    clockStart: '04:12:00',
  };
}

/**
 * M7 word scene. Camera holds the cameo head; 3Jane speaks the three-note
 * stub. Campaign typing / Kuang dive remain M7.7 / M7.9.
 */
export function straylightM7Timeline(): SimstimTimeline {
  return {
    id: STRAYLIGHT_M7_ID,
    scene: STRAYLIGHT_SCENE,
    cameraPath: [
      { t: 0, pos: { x: 0.16, y: 1.52, z: -30.2 }, look: { x: 0, y: 1.48, z: -35 }, bob: 0.01 },
      { t: 3.4, pos: { x: 0.18, y: 1.5, z: -31.5 }, look: { x: 0, y: 1.52, z: -35.2 }, bob: 0.012 },
      {
        t: 7.4,
        pos: { x: 0.06, y: 1.48, z: -32.7 },
        look: { x: 0, y: 1.58, z: -35.4 },
        bob: 0.008,
      },
      { t: 10, pos: { x: 0.0, y: 1.46, z: -33.1 }, look: { x: 0, y: 1.62, z: -35.5 }, bob: 0.006 },
      {
        t: 13.5,
        pos: { x: -0.35, y: 1.5, z: -32.3 },
        look: { x: 1.05, y: 1.45, z: -34.1 },
        bob: 0.01,
      },
    ],
    figures: [
      {
        id: 'jane',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: 1.25, y: 0, z: -34.1 }, yaw: -0.7 },
          { t: 8, pose: 'wait', pos: { x: 1.2, y: 0, z: -34.0 }, yaw: -0.55 },
        ],
      },
      {
        id: 'hideo',
        rig: 'mannequin',
        keys: [{ t: 0, pose: 'stand', pos: { x: -1.55, y: 0, z: -33.6 }, yaw: 0.5 }],
      },
      {
        id: 'riviera',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: 1.7, y: 0, z: -31.4 }, yaw: -1.1 },
          { t: 11, pose: 'wait', pos: { x: 1.55, y: 0, z: -31.8 }, yaw: -0.9 },
        ],
      },
    ],
    lines: [
      { t: 1.1, who: 'molly', text: 'The head.' },
      { t: 4.2, who: 'molly', text: "She's here." },
      { t: 8.05, who: '3jane', text: STRAYLIGHT_WORD },
      { t: 11.2, who: '3jane', text: 'Take your word, thief.' },
    ],
    branches: hold(STRAYLIGHT_M7_GATES),
    clockStart: '04:41:08',
  };
}
