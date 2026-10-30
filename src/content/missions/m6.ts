import type { MissionDef } from '../../narrative/schema';

/**
 * M6 — "The Beach" (plan §4.4 / M7.10). Walking-only Neuromancer construct.
 * No deck, no HUD, no flight. Rio coords are flavour; the run never flies.
 */
export const M6_START = { region: 'RIO', x: 312.0, z: 210.4, y: 4 } as const;
export const M6_BASS = 'bass-edge';
export const M6_HEAR_RADIUS = 14;

/**
 * Playable M6. Objectives: wake on the sand, optional bass tell, then
 * **choose** — walk out (continue toward M7) or stay (Ending B).
 */
export function m6Mission(): MissionDef {
  return {
    id: 'm6',
    act: 4,
    title: 'The Beach',
    briefing: { ink: 'm6', knot: 'brief' },
    debrief: { ink: 'm6', knot: 'debrief' },
    start: { coords: { ...M6_START }, jackInSequence: 'short' },
    softsAvailable: [],
    landmarks: [],
    targets: [],
    objectives: [
      {
        id: 'wake',
        text: 'Wake on the beach',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'flag', name: 'on-beach' },
      },
      {
        id: 'hear',
        text: 'Follow the bass',
        when: { t: 'flag', name: 'on-beach' },
        complete: { t: 'near', landmark: M6_BASS, radius: M6_HEAR_RADIUS },
        optional: true,
      },
      {
        id: 'leave',
        text: 'Walk out',
        when: { t: 'flag', name: 'on-beach' },
        complete: { t: 'event', type: 'beachChoice', where: { choice: 'leave' } },
        optional: true,
      },
      {
        id: 'stay',
        text: 'Sit with Linda through one more sunset',
        when: { t: 'flag', name: 'on-beach' },
        complete: { t: 'event', type: 'beachChoice', where: { choice: 'stay' } },
        optional: true,
      },
      {
        id: 'choose',
        text: 'Walk out, or stay',
        when: { t: 'flag', name: 'on-beach' },
        complete: { t: 'event', type: 'beachChoice' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'setFlag', name: 'on-beach', value: true },
          { a: 'music', state: 'beach' },
          { a: 'say', who: 'system', line: 'SAND. NO DECK. FOLLOW THE BASS, OR SIT.' },
        ],
      },
      {
        at: { t: 'event', type: 'beachChoice', where: { choice: 'leave' } },
        do: [{ a: 'setFlag', name: 'beachLeft', value: true }],
      },
      {
        at: { t: 'event', type: 'beachChoice', where: { choice: 'stay' } },
        do: [{ a: 'setFlag', name: 'endingB', value: true }],
      },
    ],
    fail: [],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'shore', at: { t: 'flag', name: 'on-beach' } },
      { id: 'leave', at: { t: 'event', type: 'beachChoice', where: { choice: 'leave' } } },
      { id: 'stay', at: { t: 'event', type: 'beachChoice', where: { choice: 'stay' } } },
    ],
  };
}
