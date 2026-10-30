import type { IceDef } from '../../breach/IceModel';
import { ICE_LAYER_PRESETS } from '../ice/presets';
import { Beam } from '../../render/lines/BeamBatch';
import type { MissionDef } from '../../narrative/schema';
import {
  panicRekeyEvery,
  SENSE_NET_CAMPAIGN_GATES,
  SENSE_NET_CAMPAIGN_PANIC_AT,
  SENSE_NET_ICE_NODES,
  SENSE_NET_PANIC_S,
  SENSE_NET_TIMELINE_ID,
} from '../simstim/senseNet';

/** Sprawl loft, looking toward the Sense/Net broadcast cluster (plan §4.4). */
export const M2_START = { region: 'BAMA', x: 166.4, z: 98.1, y: 360 } as const;
export const M2_ICE_ID = 'sense-net';
export const M2_TARGET = 'flatline-rom';
export const M2_RECORD = 'REC-FLATLINE-ROM';
export const M2_LANDMARK = 'sense-net';

const GRAY_2 = ICE_LAYER_PRESETS['gray-2'].rekeyEvery ?? [7, 10];
const GRAY_3 = ICE_LAYER_PRESETS['gray-3'].rekeyEvery ?? [6, 8];

export const M2_REKEY = {
  lobby: [...GRAY_2] as [number, number],
  corridor: [...GRAY_2] as [number, number],
  vault: [...GRAY_3] as [number, number],
};

export const M2_REKEY_PANIC = {
  lobby: panicRekeyEvery(M2_REKEY.lobby),
  corridor: panicRekeyEvery(M2_REKEY.corridor),
  vault: panicRekeyEvery(M2_REKEY.vault),
};

/** Three nested gray shells; each layer is one Sense/Net lock. */
export function senseNetIce(): IceDef {
  return {
    id: M2_ICE_ID,
    class: 'gray',
    shell: 'octa',
    radius: 14,
    layers: [
      { ...structuredClone(ICE_LAYER_PRESETS['gray-2']), rekeyEvery: [...M2_REKEY.lobby] },
      { ...structuredClone(ICE_LAYER_PRESETS['gray-2']), rekeyEvery: [...M2_REKEY.corridor] },
      { ...structuredClone(ICE_LAYER_PRESETS['gray-3']), rekeyEvery: [...M2_REKEY.vault] },
    ],
    hue: Beam.AMBER,
  };
}

export function gateIceNode(layer: number): (typeof SENSE_NET_ICE_NODES)[number] | undefined {
  return SENSE_NET_ICE_NODES[layer];
}

/** Apply (or restore) the panic re-key interval on every Sense/Net layer. */
export function applySenseNetRekey(
  ice: {
    def: IceDef;
    state: { t: number; current: { index: number; nextRekeyAt: number | null } };
  },
  panic: boolean,
): void {
  const rates = panic
    ? [M2_REKEY_PANIC.lobby, M2_REKEY_PANIC.corridor, M2_REKEY_PANIC.vault]
    : [M2_REKEY.lobby, M2_REKEY.corridor, M2_REKEY.vault];
  for (let i = 0; i < ice.def.layers.length; i++) {
    const layer = ice.def.layers[i]!;
    const prev = layer.rekeyEvery;
    const next = rates[i] ?? rates[0]!;
    layer.rekeyEvery = [next[0], next[1]];
    if (i !== ice.state.current.index || !prev || ice.state.current.nextRekeyAt == null) continue;
    const remain = Math.max(0, ice.state.current.nextRekeyAt - ice.state.t);
    const scale = next[0] / Math.max(prev[0], 1e-6);
    ice.state.current.nextRekeyAt = ice.state.t + remain * scale;
  }
}

/**
 * M2 — "Sense/Net" (plan §4.4 / M7.5). First simstim sync run.
 * Dixie-less: system lines + Molly's three-word feed.
 */
export function m2Mission(): MissionDef {
  const lobby = SENSE_NET_CAMPAIGN_GATES[0]!;
  const corridor = SENSE_NET_CAMPAIGN_GATES[1]!;
  const vault = SENSE_NET_CAMPAIGN_GATES[2]!;
  const panicEnd = SENSE_NET_CAMPAIGN_PANIC_AT + SENSE_NET_PANIC_S;

  return {
    id: 'm2',
    act: 2,
    title: 'Sense/Net',
    briefing: { ink: 'm2', knot: 'brief' },
    debrief: { ink: 'm2', knot: 'debrief' },
    start: { coords: { ...M2_START }, jackInSequence: 'short' },
    softsAvailable: ['probe', 'clamp', 'damper'],
    landmarks: ['sense-net', 'esfa', 'mitsubishi-boa'],
    targets: [
      {
        id: M2_TARGET,
        landmark: M2_LANDMARK,
        ice: M2_ICE_ID,
        core: { seed: 4, strata: 6, targetRecord: M2_RECORD },
      },
    ],
    simstim: {
      timeline: SENSE_NET_TIMELINE_ID,
      gates: SENSE_NET_CAMPAIGN_GATES.map((g) => ({
        id: g.id,
        iceNode: g.iceNode,
        tMeat: g.tMeat,
        early: g.early,
        late: g.late,
        onEarly: g.onEarly,
        onLate: g.onLate,
      })),
    },
    objectives: [
      {
        id: 'approach',
        text: 'Punch to Sense/Net',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'near', landmark: M2_LANDMARK, radius: 420 },
      },
      {
        id: 'lobby',
        text: 'Open the lobby door',
        when: { t: 'flag', name: 'at-sensenet' },
        complete: { t: 'event', type: 'gateWindow', where: { gateId: lobby.id, state: 'hit' } },
      },
      {
        id: 'corridor',
        text: 'Open the corridor lock',
        when: { t: 'event', type: 'gateWindow', where: { gateId: lobby.id, state: 'hit' } },
        complete: { t: 'event', type: 'gateWindow', where: { gateId: corridor.id, state: 'hit' } },
      },
      {
        id: 'vault',
        text: 'Crack the vault seal',
        when: { t: 'event', type: 'gateWindow', where: { gateId: corridor.id, state: 'hit' } },
        complete: { t: 'event', type: 'gateWindow', where: { gateId: vault.id, state: 'hit' } },
      },
      {
        id: 'out',
        text: 'Hold J — Molly walks the construct out',
        when: { t: 'flag', name: 'got-construct' },
        complete: { t: 'event', type: 'jackOut' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'transit' },
          { a: 'say', who: 'system', line: 'LINK LIVE. MOLLY IN THE LOBBY. T TO FLIP.' },
        ],
      },
      {
        at: { t: 'near', landmark: M2_LANDMARK, radius: 420 },
        do: [
          { a: 'setFlag', name: 'at-sensenet', value: true },
          { a: 'music', state: 'approach' },
          { a: 'say', who: 'system', line: 'GRAY ICE. THREE LOCKS. WATCH HER CLOCK.' },
        ],
      },
      {
        at: { t: 'event', type: 'iceEngaged', where: { iceId: M2_ICE_ID } },
        do: [
          { a: 'music', state: 'breach' },
          { a: 'say', who: 'system', line: 'MATCH RATIO. TUNE PHASE. HIT THE WINDOW.' },
        ],
      },
      {
        at: { t: 'event', type: 'gateWindow', where: { gateId: lobby.id, state: 'hit' } },
        do: [
          { a: 'sfx', id: 'shatter' },
          { a: 'say', who: 'system', line: 'LOBBY OPEN.' },
        ],
      },
      {
        at: { t: 'event', type: 'gateWindow', where: { gateId: corridor.id, state: 'hit' } },
        do: [
          { a: 'sfx', id: 'shatter' },
          { a: 'say', who: 'system', line: 'CORRIDOR OPEN.' },
        ],
      },
      {
        at: { t: 'meatTime', s: SENSE_NET_CAMPAIGN_PANIC_AT },
        do: [
          { a: 'setFlag', name: 'panic', value: true },
          { a: 'iceMod', ice: M2_ICE_ID, patch: { rekeyEvery: M2_REKEY_PANIC.lobby } },
          { a: 'say', who: 'molly', line: 'Moderns. Move.' },
          { a: 'say', who: 'system', line: 'PANIC. REKEY HALVED. NINETY SECONDS.' },
          { a: 'music', state: 'breach' },
        ],
      },
      {
        at: { t: 'meatTime', s: panicEnd },
        do: [
          { a: 'setFlag', name: 'panic', value: false },
          { a: 'iceMod', ice: M2_ICE_ID, patch: { rekeyEvery: M2_REKEY.lobby } },
          { a: 'say', who: 'system', line: 'PANIC OVER. REKEY RESTORED.' },
        ],
      },
      {
        at: { t: 'event', type: 'gateWindow', where: { gateId: vault.id, state: 'hit' } },
        do: [
          { a: 'setFlag', name: 'got-construct', value: true },
          { a: 'sfx', id: 'shatter' },
          { a: 'say', who: 'molly', line: 'Construct. Going.' },
          { a: 'say', who: 'system', line: 'GOT THE ROM. HOLD J.' },
        ],
      },
    ],
    fail: [
      { t: 'event', type: 'flatline', where: { scripted: false } },
      { t: 'event', type: 'gateWindow', where: { state: 'missed' } },
    ],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'approach', at: { t: 'near', landmark: M2_LANDMARK, radius: 420 } },
      {
        id: 'lobby',
        at: { t: 'event', type: 'gateWindow', where: { gateId: lobby.id, state: 'hit' } },
      },
      { id: 'panic', at: { t: 'meatTime', s: SENSE_NET_CAMPAIGN_PANIC_AT } },
      {
        id: 'vault',
        at: { t: 'event', type: 'gateWindow', where: { gateId: vault.id, state: 'hit' } },
      },
    ],
  };
}
