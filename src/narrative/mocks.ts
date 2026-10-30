import type { MissionDef } from './schema';

/**
 * Structural mock missions for the runner, unit tests, and `?mission=`.
 * No story content — campaign missions are M7.4+.
 */

export function mockTriggerMission(): MissionDef {
  return {
    id: 'mock-triggers',
    act: 1,
    title: 'Mock Triggers',
    briefing: { ink: 'mock', knot: 'brief' },
    debrief: { ink: 'mock', knot: 'debrief' },
    start: { coords: { region: 'CHBA', x: 10, z: 20, y: 100 }, jackInSequence: 'short' },
    softsAvailable: ['probe'],
    landmarks: ['alpha', 'beta'],
    targets: [
      {
        id: 'core-1',
        landmark: 'alpha',
        ice: 'test-white',
        core: { seed: 1, strata: 2, targetRecord: 'REC-MOCK' },
      },
    ],
    objectives: [
      {
        id: 'scan',
        text: 'Scan the node',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'event', type: 'scanPulse' },
      },
      {
        id: 'arrive',
        text: 'Reach alpha',
        when: { t: 'flag', name: 'scanned' },
        complete: { t: 'near', landmark: 'alpha', radius: 20 },
        optional: true,
      },
      {
        id: 'combo',
        text: 'All-any combo',
        when: {
          t: 'any',
          of: [
            { t: 'flag', name: 'ready' },
            { t: 'time', s: 99 },
          ],
        },
        complete: {
          t: 'all',
          of: [
            { t: 'event', type: 'downloadProgress', where: { value: 1 } },
            { t: 'near', landmark: 'beta', radius: 5 },
          ],
        },
      },
    ],
    timeline: [
      {
        at: { t: 'time', s: 1 },
        do: [
          { a: 'setFlag', name: 't1', value: true },
          { a: 'say', who: 'system', line: 'tick.one' },
        ],
      },
      { at: { t: 'meatTime', s: 2 }, do: [{ a: 'say', who: 'molly', line: 'meat.two' }] },
      {
        at: { t: 'event', type: 'scanPulse' },
        do: [
          { a: 'setFlag', name: 'scanned', value: true },
          { a: 'sfx', id: 'scan' },
        ],
      },
      {
        at: { t: 'near', landmark: 'alpha', radius: 20 },
        do: [{ a: 'setFlag', name: 'arrived', value: true }],
      },
      { at: { t: 'flag', name: 't1' }, do: [{ a: 'say', who: 'system', line: 'flag.t1' }] },
      {
        at: {
          t: 'all',
          of: [
            { t: 'flag', name: 'scanned' },
            { t: 'near', landmark: 'alpha', radius: 20 },
          ],
        },
        do: [
          { a: 'setFlag', name: 'ready', value: true },
          { a: 'objective', id: 'combo', state: 'active' },
          { a: 'music', state: 'approach' },
          { a: 'ink', knot: 'mock-ready' },
        ],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'test-white' } },
        do: [
          { a: 'iceMod', ice: 'test-white', patch: { rekeyEvery: [3, 5] } },
          { a: 'wintermute', action: { kind: 'freeze', on: true } },
          { a: 'neuromancer', action: { kind: 'soften', amount: 0.25 } },
          { a: 'forceMode', mode: 'breach' },
        ],
      },
    ],
    fail: [
      { t: 'event', type: 'flatline', where: { scripted: false } },
      {
        t: 'any',
        of: [
          { t: 'flag', name: 'abort' },
          { t: 'time', s: 1000 },
        ],
      },
    ],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'mid', at: { t: 'flag', name: 'ready' } },
    ],
  };
}

export function mockSimstimMission(): MissionDef {
  const base = mockTriggerMission();
  return {
    ...base,
    id: 'mock-simstim',
    title: 'Mock Simstim',
    simstim: {
      timeline: 'lab-simstim',
      gates: [
        {
          id: 'door-1',
          iceNode: 'sense-net-door',
          tMeat: 8,
          early: 3,
          late: 2,
          onEarly: [],
          onLate: [],
        },
      ],
    },
  };
}

/** Structural M2 stub so `?mission=m2` plays the Sense/Net timeline (M6.2). */
export function mockM2Mission(): MissionDef {
  const base = mockTriggerMission();
  return {
    ...base,
    id: 'm2',
    act: 2,
    title: 'Sense/Net',
    simstim: {
      timeline: 'sense-net',
      gates: [
        {
          id: 'lobby-door',
          iceNode: 'sense-net-lobby',
          tMeat: 3,
          early: 1.5,
          late: 1.5,
          onEarly: [],
          onLate: [],
        },
        {
          id: 'corridor-lock',
          iceNode: 'sense-net-corridor',
          tMeat: 8,
          early: 1.5,
          late: 1.5,
          onEarly: [],
          onLate: [],
        },
        {
          id: 'vault-seal',
          iceNode: 'sense-net-vault',
          tMeat: 13,
          early: 1.5,
          late: 1.5,
          onEarly: [],
          onLate: [],
        },
      ],
    },
  };
}

const FACTORIES: Record<string, () => MissionDef> = {
  'mock-triggers': mockTriggerMission,
  'mock-simstim': mockSimstimMission,
  mock: mockTriggerMission,
  m2: mockM2Mission,
};

export function getMockMission(id: string): MissionDef | undefined {
  return FACTORIES[id]?.();
}

export function mockMissionIds(): string[] {
  return Object.keys(FACTORIES);
}
