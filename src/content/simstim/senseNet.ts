import type { Action } from '../../narrative/schema';
import type { GateDef } from '../../simstim/Gates';
import type { SimstimTimeline } from './types';

/** Compressed stub clock. M7.5 retimes the panic to book-meat 4:00. */
export const SENSE_NET_PANIC_AT = 9;
export const SENSE_NET_SCENE = 'sensenet';
export const SENSE_NET_TIMELINE_ID = 'sense-net';

const none: Action[] = [];

/** Three Sense/Net gate windows (lobby door, corridor lock, vault seal). */
export const SENSE_NET_GATES: GateDef[] = [
  {
    id: 'lobby-door',
    iceNode: 'sense-net-lobby',
    tMeat: 3,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
  {
    id: 'corridor-lock',
    iceNode: 'sense-net-corridor',
    tMeat: 8,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
  {
    id: 'vault-seal',
    iceNode: 'sense-net-vault',
    tMeat: 13,
    early: 1.5,
    late: 1.5,
    onEarly: none,
    onLate: none,
  },
];

/**
 * M6.2 Sense/Net timeline. Camera walks lobby → corridor → vault. Panic
 * crowd unhides at `SENSE_NET_PANIC_AT`. Molly lines are invented stubs
 * (terse, ≤ 3 words) — campaign copy is M7.5.
 */
export function senseNetTimeline(): SimstimTimeline {
  return {
    id: SENSE_NET_TIMELINE_ID,
    scene: SENSE_NET_SCENE,
    cameraPath: [
      { t: 0, pos: { x: 0.35, y: 1.55, z: 2.1 }, look: { x: -0.8, y: 1.4, z: -5.5 }, bob: 0.018 },
      { t: 1.4, pos: { x: 0.15, y: 1.55, z: -1.2 }, look: { x: 0.2, y: 1.38, z: -9 }, bob: 0.02 },
      { t: 2.6, pos: { x: 0.1, y: 1.55, z: -6.8 }, look: { x: 0, y: 1.35, z: -12 }, bob: 0.022 },
      { t: 4.2, pos: { x: 0, y: 1.56, z: -11.4 }, look: { x: 0.05, y: 1.4, z: -18 }, bob: 0.02 },
      { t: 7.4, pos: { x: 0.08, y: 1.55, z: -18.2 }, look: { x: 0, y: 1.32, z: -24 }, bob: 0.021 },
      {
        t: 9.3,
        pos: { x: 0.22, y: 1.58, z: -21.2 },
        look: { x: 0.5, y: 1.25, z: -13 },
        bob: 0.024,
      },
      { t: 11.2, pos: { x: 0, y: 1.55, z: -26.4 }, look: { x: 0, y: 1.2, z: -34 }, bob: 0.018 },
      {
        t: 14.4,
        pos: { x: 0.04, y: 1.5, z: -32.6 },
        look: { x: 0, y: 1.05, z: -36.8 },
        bob: 0.012,
      },
      { t: 16, pos: { x: 0, y: 1.48, z: -33.4 }, look: { x: 0, y: 1.02, z: -37.2 }, bob: 0.01 },
    ],
    figures: [
      {
        id: 'guard-lobby',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: 2.4, y: 0, z: -7.2 }, yaw: Math.PI },
          { t: 9, pose: 'wait', pos: { x: 2.1, y: 0, z: -6.4 }, yaw: Math.PI * 0.7 },
        ],
      },
      {
        id: 'guard-desk',
        rig: 'mannequin',
        keys: [{ t: 0, pose: 'stand', pos: { x: -3.6, y: 0, z: -4.2 }, yaw: 0.4 }],
      },
      {
        id: 'guard-corridor',
        rig: 'mannequin',
        keys: [
          { t: 0, pose: 'stand', pos: { x: 1.55, y: 0, z: -18.6 }, yaw: Math.PI },
          { t: 9.2, pose: 'wait', pos: { x: 1.7, y: 0, z: -17.8 }, yaw: Math.PI * 1.15 },
        ],
      },
      {
        id: 'guard-vault',
        rig: 'mannequin',
        keys: [{ t: 0, pose: 'stand', pos: { x: -1.7, y: 0, z: -29.4 }, yaw: 0.2 }],
      },
      ...panicCrowd(),
    ],
    lines: [
      { t: 0.7, who: 'molly', text: "I'm in." },
      { t: 2.5, who: 'molly', text: 'Lobby door.' },
      { t: 5.2, who: 'molly', text: "Hall's long." },
      { t: 7.6, who: 'molly', text: 'Second lock.' },
      { t: 9.35, who: 'molly', text: 'Moderns. Move.' },
      { t: 12.2, who: 'molly', text: 'Vault.' },
      { t: 14.6, who: 'molly', text: 'Construct. Going.' },
    ],
    branches: SENSE_NET_GATES.map((g) => ({
      atGate: g.id,
      onLate: { holdUntilOpen: true, exposurePerSec: 0.04 },
    })),
    clockStart: '00:00:00',
  };
}

function panicCrowd(): SimstimTimeline['figures'] {
  const seeds: Array<{ id: string; x: number; z: number; yaw: number; dx: number; dz: number }> = [
    { id: 'crowd-0', x: -2.2, z: -3.4, yaw: 0.2, dx: -3.4, dz: 4.2 },
    { id: 'crowd-1', x: 1.6, z: -4.8, yaw: -0.4, dx: 4.1, dz: 3.6 },
    { id: 'crowd-2', x: -0.4, z: -8.2, yaw: 0.1, dx: -2.8, dz: 5.5 },
    { id: 'crowd-3', x: 2.0, z: -12.4, yaw: Math.PI, dx: 3.6, dz: 2.4 },
    { id: 'crowd-4', x: -1.8, z: -14.6, yaw: 0.6, dx: -3.2, dz: 1.8 },
    { id: 'crowd-5', x: 0.6, z: -16.8, yaw: -0.2, dx: 2.4, dz: 4.8 },
    { id: 'crowd-6', x: -2.4, z: -5.8, yaw: 0.9, dx: -4.0, dz: 3.1 },
    { id: 'crowd-7', x: 1.1, z: -9.6, yaw: -0.8, dx: 3.8, dz: 5.0 },
  ];
  return seeds.map((s) => ({
    id: s.id,
    rig: 'crowd',
    keys: [
      { t: 0, pose: 'hidden', pos: { x: s.x, y: 0, z: s.z }, yaw: s.yaw },
      {
        t: SENSE_NET_PANIC_AT - 0.05,
        pose: 'hidden',
        pos: { x: s.x, y: 0, z: s.z },
        yaw: s.yaw,
      },
      { t: SENSE_NET_PANIC_AT, pose: 'run', pos: { x: s.x, y: 0, z: s.z }, yaw: s.yaw },
      {
        t: SENSE_NET_PANIC_AT + 4,
        pose: 'run',
        pos: { x: s.x + s.dx, y: 0, z: s.z + s.dz },
        yaw: s.yaw + 0.4,
      },
    ],
  }));
}
