import type { MissionDef } from '../../narrative/schema';

/**
 * P0 — Prologue: Night City (plan §4.4 / M7.4). Teletext only.
 * Dixie-less: system terminal lines, not companion barks.
 */
export function p0Mission(): MissionDef {
  return {
    id: 'p0',
    act: 1,
    title: 'Night City',
    briefing: { ink: 'p0', knot: 'start' },
    debrief: { ink: 'p0', knot: 'start' },
    start: { coords: { region: 'CHBA', x: 412.9, z: 180.2, y: 40 }, jackInSequence: 'full' },
    softsAvailable: [],
    landmarks: ['chatsubo', 'cheap-hotel', 'ninsei', 'chiba-node'],
    targets: [],
    objectives: [
      {
        id: 'wake',
        text: 'Read the Night City pages',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'event', type: 'jackOut', where: { reason: 'script' } },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'silent' },
          { a: 'say', who: 'system', line: 'NITE CITY — CHANNEL IDENT' },
        ],
      },
    ],
    fail: [],
    checkpoints: [{ id: 'start', at: { t: 'event', type: 'jackIn' } }],
  };
}
