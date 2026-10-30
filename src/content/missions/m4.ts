import type { IceDef } from '../../breach/IceModel';
import type { Difficulty } from '../../core/settings';
import { Beam } from '../../render/lines/BeamBatch';
import type { MissionDef } from '../../narrative/schema';
import { ICE_LAYER_PRESETS } from '../ice/presets';
import { rekeyScale, tuneLayer } from '../tuning';

/** EURO pad looking at the Geneva Registry (plan §4.4 / M7.7). */
export const M4_START = { region: 'EURO', x: 248.0, z: 71.55, y: 1800 } as const;
export const M4_DROP = 'turing-geneva';
export const M4_ICE_ID = 'turing-record';
export const M4_TARGET = 'turing-file';
export const M4_RECORD = 'REC-TURING-CASE';
export const M4_NEAR = 280;
/** Heat at or above this stacks extra watchers and shortens re-key. */
export const M4_HEAT_HARD = 2;

export function turingRekeyScale(heat: number, difficulty: Difficulty = 'normal'): number {
  return rekeyScale(difficulty, heat);
}

/** One gray layer — light on breaching (≤ 2). Heat + difficulty scale §12.3. */
export function turingIce(heat = 0, difficulty: Difficulty = 'normal'): IceDef {
  const layer = tuneLayer(structuredClone(ICE_LAYER_PRESETS['gray-2']), { difficulty, heat });
  return {
    id: M4_ICE_ID,
    class: 'gray',
    shell: 'octa',
    radius: 10,
    layers: [layer],
    hue: Beam.MIL,
  };
}

/**
 * M4 — "Turing" (plan §4.4 / M7.7). Stealth/trace through Turing watchers,
 * DECOY and flight, then wipe a Registry record. Act III interludes live in
 * `ink/m4.ink` (Istanbul phones, Freeside agents, Wintermute meat).
 */
export function m4Mission(): MissionDef {
  return {
    id: 'm4',
    act: 3,
    title: 'Turing',
    briefing: { ink: 'm4', knot: 'brief' },
    debrief: { ink: 'm4', knot: 'debrief' },
    start: { coords: { ...M4_START }, jackInSequence: 'short' },
    softsAvailable: ['decoy', 'probe', 'clamp', 'damper'],
    landmarks: [M4_DROP],
    targets: [
      {
        id: M4_TARGET,
        landmark: M4_DROP,
        ice: M4_ICE_ID,
        core: { seed: 13, strata: 7, targetRecord: M4_RECORD },
      },
    ],
    objectives: [
      {
        id: 'drop',
        text: 'Reach the Turing data drop',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'near', landmark: M4_DROP, radius: M4_NEAR },
      },
      {
        id: 'crack',
        text: 'Crack the Registry file',
        when: { t: 'flag', name: 'at-drop' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: M4_ICE_ID } },
        optional: true,
      },
      {
        id: 'wipe',
        text: 'Wipe the record',
        when: { t: 'flag', name: 'at-drop' },
        complete: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
      },
      {
        id: 'out',
        text: 'Jack out',
        when: { t: 'flag', name: 'wiped' },
        complete: { t: 'event', type: 'jackOut' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'transit' },
          { a: 'say', who: 'system', line: 'TURING SWEEPS. DECOY LIVE. DO NOT GET SEEN.' },
        ],
      },
      {
        at: { t: 'near', landmark: M4_DROP, radius: M4_NEAR },
        do: [
          { a: 'setFlag', name: 'at-drop', value: true },
          { a: 'music', state: 'approach' },
        ],
      },
      {
        at: { t: 'event', type: 'iceEngaged', where: { iceId: M4_ICE_ID } },
        do: [{ a: 'music', state: 'breach' }],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: M4_ICE_ID } },
        do: [
          { a: 'setFlag', name: 'cracked', value: true },
          { a: 'sfx', id: 'shatter' },
          { a: 'music', state: 'core' },
        ],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
        do: [{ a: 'setFlag', name: 'wiped', value: true }],
      },
    ],
    fail: [],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'drop', at: { t: 'near', landmark: M4_DROP, radius: M4_NEAR } },
      { id: 'wipe', at: { t: 'event', type: 'downloadProgress', where: { value: 1 } } },
    ],
  };
}
