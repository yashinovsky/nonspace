import type { IceDef } from '../breach/IceModel';
import { ICE_LAYER_PRESETS } from '../content/ice/presets';
import type { SimstimTimeline } from '../content/simstim/types';
import type { MissionDef } from '../narrative/schema';
import { Beam } from '../render/lines/BeamBatch';

/** Small valid instances of the §9 contracts for tests and labs. Each call returns a fresh copy. */

export function sampleIceDef(overrides: Partial<IceDef> = {}): IceDef {
  return {
    id: 'test-white',
    class: 'white',
    shell: 'cube',
    radius: 40,
    layers: [structuredClone(ICE_LAYER_PRESETS['white-1'])],
    hue: Beam.ICE,
    ...overrides,
  };
}

export function sampleBlackIceDef(overrides: Partial<IceDef> = {}): IceDef {
  return {
    id: 'test-black',
    class: 'black',
    shell: 'icosa',
    radius: 60,
    layers: [
      structuredClone(ICE_LAYER_PRESETS['gray-3']),
      structuredClone(ICE_LAYER_PRESETS['black-1']),
    ],
    hue: Beam.MIL,
    ...overrides,
  };
}

export function sampleMission(): MissionDef {
  return {
    id: 'test-mission',
    act: 1,
    title: 'Test Run',
    briefing: { ink: 'test', knot: 'briefing' },
    debrief: { ink: 'test', knot: 'debrief' },
    start: { coords: { region: 'CHBA', x: 412.77, z: 180.03, y: 250 }, jackInSequence: 'short' },
    softsAvailable: ['probe'],
    landmarks: ['chiba-node'],
    targets: [
      {
        id: 'ledger',
        landmark: 'chiba-node',
        ice: 'test-white',
        core: { seed: 1234, strata: 6, targetRecord: 'REC-0001' },
      },
    ],
    objectives: [
      {
        id: 'crack',
        text: 'Crack the ICE',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'test-white' } },
      },
      {
        id: 'download',
        text: 'Download the ledger',
        when: { t: 'flag', name: 'cracked' },
        complete: {
          t: 'all',
          of: [
            { t: 'event', type: 'downloadProgress', where: { value: 1 } },
            { t: 'near', landmark: 'chiba-node', radius: 300 },
          ],
        },
      },
    ],
    timeline: [
      { at: { t: 'time', s: 2 }, do: [{ a: 'say', who: 'system', line: 'tutorial.engage' }] },
      {
        at: { t: 'event', type: 'iceLayerCracked' },
        do: [
          { a: 'setFlag', name: 'cracked', value: true },
          { a: 'objective', id: 'download', state: 'active' },
          { a: 'sfx', id: 'shatter' },
        ],
      },
    ],
    fail: [{ t: 'event', type: 'flatline' }],
    checkpoints: [{ id: 'start', at: { t: 'event', type: 'jackIn' } }],
  };
}

export function sampleTimeline(): SimstimTimeline {
  return {
    id: 'test-timeline',
    scene: 'simstim/test.glb',
    cameraPath: [
      { t: 0, pos: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -1 } },
      { t: 10, pos: { x: 0, y: 1.6, z: -8 }, look: { x: 0, y: 1.6, z: -9 }, bob: 0.02 },
    ],
    figures: [
      {
        id: 'guard',
        rig: 'mannequin',
        keys: [{ t: 0, pose: 'stand', pos: { x: 2, y: 0, z: -6 }, yaw: Math.PI }],
      },
    ],
    lines: [{ t: 1, who: 'molly', text: 'Going in.' }],
    branches: [{ atGate: 'door-1', onLate: { holdUntilOpen: true, exposurePerSec: 0.04 } }],
    clockStart: '02:14:07',
  };
}
