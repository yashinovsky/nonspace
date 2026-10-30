import { CHIBA_CLUSTER_IDS } from '../landmarks';
import type { MissionDef } from '../../narrative/schema';

/** First jack-in in years: Sprawl loft view, then punch into Chiba (plan §4.4). */
export const M1_START = { region: 'BAMA', x: 164.2, z: 98.5, y: 240 } as const;
export const M1_LOOK_S = 20;
export const M1_ICE_ID = 'white-clinic';
export const M1_TARGET = 'clinic-ledger';
export const M1_RECORD = 'REC-CHIBA-CLINIC';

/**
 * M1 — "Distanceless Home" (plan §4.4 / M7.4). Tutorial run.
 * Dixie-less: Hershey facet labels + system terminal lines.
 */
export function m1Mission(): MissionDef {
  return {
    id: 'm1',
    act: 1,
    title: 'Distanceless Home',
    briefing: { ink: 'm1', knot: 'brief' },
    debrief: { ink: 'm1', knot: 'debrief' },
    start: { coords: { ...M1_START }, jackInSequence: 'full' },
    softsAvailable: ['probe', 'clamp'],
    landmarks: ['esfa', 'mitsubishi-boa', 'sense-net', ...CHIBA_CLUSTER_IDS],
    targets: [
      {
        id: M1_TARGET,
        landmark: 'chiba-node',
        ice: M1_ICE_ID,
        core: { seed: 7, strata: 6, targetRecord: M1_RECORD },
      },
    ],
    objectives: [
      {
        id: 'look',
        text: 'Look. No marker.',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'time', s: M1_LOOK_S },
        optional: true,
      },
      {
        id: 'scan',
        text: 'Scan a facet (F)',
        when: { t: 'time', s: M1_LOOK_S },
        complete: { t: 'event', type: 'scanPulse' },
      },
      {
        id: 'jump',
        text: 'Punch to the Chiba cluster (Tab)',
        when: { t: 'flag', name: 'scanned' },
        complete: { t: 'near', landmark: 'chiba-node', radius: 420 },
      },
      {
        id: 'breach',
        text: 'Crack the white ICE (LMB)',
        when: { t: 'flag', name: 'at-chiba' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: M1_ICE_ID } },
      },
      {
        id: 'take',
        text: 'Hold E on the clinic record',
        when: { t: 'flag', name: 'cracked' },
        complete: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
      },
      {
        id: 'out',
        text: 'Hold J to jack out',
        when: { t: 'flag', name: 'got-record' },
        complete: { t: 'event', type: 'jackOut' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'transit' },
          { a: 'say', who: 'system', line: 'LOOK. NO MARKER. THE BOARD IS YOURS.' },
        ],
      },
      {
        at: { t: 'time', s: M1_LOOK_S },
        do: [
          { a: 'setFlag', name: 'looked', value: true },
          { a: 'say', who: 'system', line: 'SCAN A FACET — F' },
        ],
      },
      {
        at: { t: 'event', type: 'scanPulse' },
        do: [
          { a: 'setFlag', name: 'scanned', value: true },
          { a: 'sfx', id: 'scan' },
          {
            a: 'say',
            who: 'system',
            line: 'CHIBA NODE  CHBA 0412.90 / 0180.20 / 0160  — TAB TO PUNCH',
          },
        ],
      },
      {
        at: { t: 'near', landmark: 'chiba-node', radius: 420 },
        do: [
          { a: 'setFlag', name: 'at-chiba', value: true },
          { a: 'music', state: 'approach' },
          { a: 'say', who: 'system', line: 'WHITE ICE. HOLD LMB WHEN THE FACET FACES YOU.' },
        ],
      },
      {
        at: { t: 'event', type: 'iceEngaged', where: { iceId: M1_ICE_ID } },
        do: [
          { a: 'music', state: 'breach' },
          { a: 'say', who: 'system', line: 'MATCH RATIO. TUNE PHASE. HOLD THE LOCK.' },
        ],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: M1_ICE_ID } },
        do: [
          { a: 'setFlag', name: 'cracked', value: true },
          { a: 'sfx', id: 'shatter' },
          { a: 'music', state: 'core' },
          { a: 'say', who: 'system', line: 'CORE OPEN. HOLD E ON THE RECORD.' },
        ],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
        do: [
          { a: 'setFlag', name: 'got-record', value: true },
          { a: 'say', who: 'system', line: 'GOT LEDGER. HOLD J TO JACK OUT.' },
        ],
      },
      {
        at: { t: 'event', type: 'jackOut', where: { reason: 'burned' } },
        do: [{ a: 'say', who: 'system', line: 'BURNED. RETRY FROM LAST JACK-IN.' }],
      },
    ],
    fail: [],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'look', at: { t: 'time', s: M1_LOOK_S } },
      { id: 'chiba', at: { t: 'near', landmark: 'chiba-node', radius: 420 } },
      { id: 'core', at: { t: 'event', type: 'iceLayerCracked', where: { iceId: M1_ICE_ID } } },
      { id: 'take', at: { t: 'event', type: 'downloadProgress', where: { value: 1 } } },
    ],
  };
}
