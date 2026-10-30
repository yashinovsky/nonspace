import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import type { MissionDef } from '../../narrative/schema';
import { TA_ICE } from '../ice/ta';
import { STRAYLIGHT_M5_GATES, STRAYLIGHT_M5_ID } from '../simstim/straylight';

/** ORBT pad below the T-A cluster (plan §4.4 / M7.9 Phase A). */
export const M5_START = { region: 'ORBT', x: 318.4, z: 38.15, y: 2400 } as const;
export const M5_CLUSTER = 'ta-straylight';
export const M5_ICE_ID = TA_ICE.id;
export const M5_TARGET = 'straylight-core';
export const M5_RECORD = 'REC-STRAYLIGHT';
export const M5_NEAR = 900;
export const M5_HIJACK = 'COUNTING.';
export const M5_PAIN = 0.9;

/** Tessier-Ashpool slab. Kuang-gate tolerance is generous (M7.8). */
export function straylightIce(): IceDef {
  return {
    ...TA_ICE,
    id: M5_ICE_ID,
    hue: Beam.TA,
  };
}

const stimGates = STRAYLIGHT_M5_GATES.map((g) => ({
  id: g.id,
  iceNode: g.iceNode,
  tMeat: g.tMeat,
  early: g.early,
  late: g.late,
  onEarly: [...g.onEarly],
  onLate: [...g.onLate],
}));

/**
 * M5 — "Kuang Grade Mark Eleven" (plan §4.4 / M7.9). Ascent to the T-A
 * cluster, deploy Kuang, Tempest tube dive with three generous gates
 * interleaved with Straylight simstim, then Neuromancer interception.
 */
export function m5Mission(): MissionDef {
  return {
    id: 'm5',
    act: 4,
    title: 'Kuang Grade Mark Eleven',
    briefing: { ink: 'm5', knot: 'brief' },
    debrief: { ink: 'm5', knot: 'debrief' },
    start: { coords: { ...M5_START }, jackInSequence: 'short' },
    softsAvailable: ['kuang', 'probe', 'clamp', 'damper'],
    landmarks: [M5_CLUSTER],
    targets: [
      {
        id: M5_TARGET,
        landmark: M5_CLUSTER,
        ice: M5_ICE_ID,
        core: { seed: 11, strata: 12, targetRecord: M5_RECORD },
      },
    ],
    simstim: {
      timeline: STRAYLIGHT_M5_ID,
      gates: stimGates,
    },
    objectives: [
      {
        id: 'ascent',
        text: 'Climb to the Tessier-Ashpool cluster',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'near', landmark: M5_CLUSTER, radius: M5_NEAR },
      },
      {
        id: 'deploy',
        text: 'Deploy Kuang Grade Mark Eleven',
        when: { t: 'flag', name: 'at-cluster' },
        complete: { t: 'flag', name: 'kuang-out' },
      },
      {
        id: 'dive',
        text: 'Ride the ICE throat',
        when: { t: 'flag', name: 'kuang-out' },
        complete: { t: 'flag', name: 'diving' },
      },
      {
        id: 'hall',
        text: 'Open the hall arch with Molly',
        when: { t: 'flag', name: 'diving' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-hall' } },
      },
      {
        id: 'stair',
        text: 'Hold the stair as her leg goes',
        when: { t: 'flag', name: 'hall-open' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-stair' } },
      },
      {
        id: 'gallery',
        text: 'Meet 3Jane at the gallery',
        when: { t: 'flag', name: 'stair-open' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-gallery' } },
      },
      {
        id: 'intercept',
        text: 'Neuromancer pulls',
        when: { t: 'flag', name: 'molly-in' },
        complete: { t: 'flag', name: 'intercepted' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'transit' },
          { a: 'say', who: 'system', line: 'ORBT. TESSIER-ASHPOOL AHEAD. KUANG ARMED.' },
        ],
      },
      {
        at: { t: 'near', landmark: M5_CLUSTER, radius: M5_NEAR },
        do: [
          { a: 'setFlag', name: 'at-cluster', value: true },
          { a: 'music', state: 'approach' },
        ],
      },
      {
        at: { t: 'event', type: 'softUsed', where: { softId: 'kuang' } },
        do: [
          { a: 'setFlag', name: 'kuang-out', value: true },
          { a: 'sfx', id: 'kuang' },
          { a: 'say', who: 'system', line: 'KUANG GRADE MARK ELEVEN. MIMIC T-A.' },
        ],
      },
      {
        at: { t: 'event', type: 'modeChanged', where: { to: 'dive' } },
        do: [
          { a: 'setFlag', name: 'diving', value: true },
          { a: 'music', state: 'kuangDive' },
        ],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-hall' } },
        do: [{ a: 'setFlag', name: 'hall-open', value: true }],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-stair' } },
        do: [
          { a: 'setFlag', name: 'stair-open', value: true },
          { a: 'wintermute', action: { kind: 'hijack', text: M5_HIJACK } },
          { a: 'say', who: 'molly', line: "Leg's gone." },
        ],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-gallery' } },
        do: [
          { a: 'setFlag', name: 'molly-in', value: true },
          { a: 'say', who: 'molly', line: '3Jane.' },
        ],
      },
      {
        at: { t: 'event', type: 'flatline', where: { scripted: true } },
        do: [
          { a: 'setFlag', name: 'intercepted', value: true },
          { a: 'neuromancer', action: { kind: 'soften', amount: 0.85 } },
          { a: 'say', who: 'system', line: "DECK WON'T LET GO" },
        ],
      },
    ],
    fail: [],
    checkpoints: [
      { id: 'ascent', at: { t: 'event', type: 'jackIn' } },
      { id: 'deploy', at: { t: 'flag', name: 'kuang-out' } },
      { id: 'dive', at: { t: 'flag', name: 'diving' } },
      { id: 'straylight', at: { t: 'flag', name: 'molly-in' } },
      { id: 'intercept', at: { t: 'flag', name: 'intercepted' } },
    ],
  };
}
