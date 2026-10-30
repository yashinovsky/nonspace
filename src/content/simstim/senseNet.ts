import type { Action } from '../../narrative/schema';
import type { GateDef } from '../../simstim/Gates';
import type { SimstimTimeline } from './types';

/** Compressed stub clock (`?lab=simstim`). Campaign M2 retimes panic to 4:00. */
export const SENSE_NET_PANIC_AT = 9;
export const SENSE_NET_SCENE = 'sensenet';
export const SENSE_NET_TIMELINE_ID = 'sense-net';

/** Book meat: midnight start, Moderns' panic at 12:04, 90 s cover. */
export const SENSE_NET_CAMPAIGN_PANIC_AT = 240;
export const SENSE_NET_PANIC_S = 90;
/** Plan §12.3 M2 starting windows. */
export const SENSE_NET_GATE_EARLY = 20;
export const SENSE_NET_GATE_LATE = 15;
export const SENSE_NET_EXPOSURE_PER_SEC = 0.04;

export const SENSE_NET_GATE_IDS = ['lobby-door', 'corridor-lock', 'vault-seal'] as const;
export const SENSE_NET_ICE_NODES = [
  'sense-net-lobby',
  'sense-net-corridor',
  'sense-net-vault',
] as const;

/** Stub t → campaign meat. Anchors: gates 3/8/13, panic 9, end 16. */
const STUB_MARKS = [0, 3, 8, 9, 13, 16] as const;
const CAMPAIGN_MARKS = [0, 80, 200, 240, 280, 340] as const;

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

/**
 * Piecewise remap of the M6.2 stub clock onto campaign meat time so panic
 * lands at 4:00 and the three gates keep their relative order.
 */
export function remapSenseNetTime(stubT: number): number {
  const stub = STUB_MARKS;
  const live = CAMPAIGN_MARKS;
  if (stubT <= stub[0]) return live[0];
  const last = stub.length - 1;
  if (stubT >= stub[last]!) {
    const span = stub[last]! - stub[last - 1]!;
    const u = span > 1e-8 ? (stubT - stub[last]!) / span : 0;
    return live[last]! + u * (live[last]! - live[last - 1]!);
  }
  for (let i = 0; i < last; i++) {
    const a = stub[i]!;
    const b = stub[i + 1]!;
    if (stubT <= b) {
      const span = b - a;
      const u = span > 1e-8 ? (stubT - a) / span : 0;
      return live[i]! + u * (live[i + 1]! - live[i]!);
    }
  }
  return live[last]!;
}

/** Halve re-key *rate* by doubling the interval (Moderns' panic). */
export function panicRekeyEvery(every: readonly [number, number]): [number, number] {
  return [every[0] * 2, every[1] * 2];
}

export const SENSE_NET_CAMPAIGN_GATES: GateDef[] = [
  {
    id: 'lobby-door',
    iceNode: 'sense-net-lobby',
    tMeat: CAMPAIGN_MARKS[1],
    early: SENSE_NET_GATE_EARLY,
    late: SENSE_NET_GATE_LATE,
    onEarly: [{ a: 'say', who: 'system', line: 'EARLY. ALERT.' }],
    onLate: none,
  },
  {
    id: 'corridor-lock',
    iceNode: 'sense-net-corridor',
    tMeat: CAMPAIGN_MARKS[2],
    early: SENSE_NET_GATE_EARLY,
    late: SENSE_NET_GATE_LATE,
    onEarly: [{ a: 'say', who: 'system', line: 'EARLY. ALERT.' }],
    onLate: none,
  },
  {
    id: 'vault-seal',
    iceNode: 'sense-net-vault',
    tMeat: CAMPAIGN_MARKS[4],
    early: SENSE_NET_GATE_EARLY,
    late: SENSE_NET_GATE_LATE,
    onEarly: [{ a: 'say', who: 'system', line: 'EARLY. ALERT.' }],
    onLate: none,
  },
];

/**
 * M7.5 campaign walk: same interiors / camera / crowd as M6.2, retimed so
 * the Moderns' panic is meat 4:00 and gate windows match §12.3.
 */
export function senseNetCampaignTimeline(): SimstimTimeline {
  const src = senseNetTimeline();
  return {
    id: SENSE_NET_TIMELINE_ID,
    scene: src.scene,
    cameraPath: src.cameraPath.map((k) => ({ ...k, t: remapSenseNetTime(k.t) })),
    figures: src.figures.map((f) => ({
      ...f,
      keys: f.keys.map((k) => ({ ...k, t: remapSenseNetTime(k.t) })),
    })),
    lines: src.lines.map((l) => ({ ...l, t: remapSenseNetTime(l.t) })),
    branches: SENSE_NET_CAMPAIGN_GATES.map((g) => ({
      atGate: g.id,
      onLate: { holdUntilOpen: true, exposurePerSec: SENSE_NET_EXPOSURE_PER_SEC },
    })),
    clockStart: src.clockStart,
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
