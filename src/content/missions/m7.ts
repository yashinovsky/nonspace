import type { IceDef } from '../../breach/IceModel';
import { Beam } from '../../render/lines/BeamBatch';
import type { MissionDef } from '../../narrative/schema';
import { TA_ICE } from '../ice/ta';
import { STRAYLIGHT_M7_GATES, STRAYLIGHT_M7_ID, STRAYLIGHT_WORD } from '../simstim/straylight';
import { tuneIce, type TuneOpts } from '../tuning';

/** Same orbital pad as M5 — back in at the T-A core (plan §4.4 / M7.11). */
export const M7_START = { region: 'ORBT', x: 318.4, z: 38.15, y: 2400 } as const;
export const M7_CLUSTER = 'ta-straylight';
export const M7_ICE_ID = TA_ICE.id;
export const M7_TARGET = 'true-name';
export const M7_RECORD = 'REC-TRUE-NAME';
export const M7_NEAR = 900;
export const M7_WORD = STRAYLIGHT_WORD;
/** Seconds after 3Jane speaks to type the word (diegetic deck climax). */
export const M7_WORD_WINDOW_S = 16;
export const M7_WORD_SPOKEN_AT = 8.05;
export const M7_HEAD_AT = 4.2;

/** Tessier-Ashpool slab still up when you jack back in. */
export function trueNameIce(opts: TuneOpts = {}): IceDef {
  return tuneIce(
    {
      ...TA_ICE,
      id: M7_ICE_ID,
      hue: Beam.TA,
    },
    opts,
  );
}

export function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function wordMatches(raw: string, target = M7_WORD): boolean {
  return normalizeWord(raw) === normalizeWord(target);
}

const stimGates = STRAYLIGHT_M7_GATES.map((g) =>
  g.id === 'word-window'
    ? {
        id: g.id,
        iceNode: g.iceNode,
        tMeat: g.tMeat,
        early: g.early,
        late: M7_WORD_WINDOW_S,
        onEarly: [...g.onEarly],
        onLate: [...g.onLate],
      }
    : {
        id: g.id,
        iceNode: g.iceNode,
        tMeat: g.tMeat,
        early: g.early,
        late: g.late,
        onEarly: [...g.onEarly],
        onLate: [...g.onLate],
      },
);

/**
 * M7 — "True Name" (plan §4.4 / M7.11). Word-entry climax, merge, Dixie
 * erase, Act V teletext, optional coda, Ending A. Ending B stays on M6.
 */
export function m7Mission(): MissionDef {
  return {
    id: 'm7',
    act: 5,
    title: 'True Name',
    briefing: { ink: 'm7', knot: 'brief' },
    debrief: { ink: 'm7', knot: 'epilogue' },
    start: { coords: { ...M7_START }, jackInSequence: 'short' },
    softsAvailable: ['kuang', 'probe', 'clamp', 'damper'],
    landmarks: [M7_CLUSTER],
    targets: [
      {
        id: M7_TARGET,
        landmark: M7_CLUSTER,
        ice: M7_ICE_ID,
        core: { seed: 23, strata: 12, targetRecord: M7_RECORD },
      },
    ],
    simstim: {
      timeline: STRAYLIGHT_M7_ID,
      gates: stimGates,
    },
    objectives: [
      {
        id: 'core',
        text: 'Jack in at the T-A core with Kuang',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'near', landmark: M7_CLUSTER, radius: M7_NEAR },
      },
      {
        id: 'watch',
        text: 'Watch the feed. Learn the word.',
        when: { t: 'flag', name: 'at-core' },
        complete: { t: 'flag', name: 'word-ready' },
      },
      {
        id: 'type',
        text: 'Open the deck and type the word',
        when: { t: 'flag', name: 'word-ready' },
        complete: { t: 'flag', name: 'word-in' },
      },
      {
        id: 'merge',
        text: 'Wintermute and Neuromancer become one',
        when: { t: 'flag', name: 'word-in' },
        complete: { t: 'flag', name: 'merged' },
      },
      {
        id: 'erase',
        text: 'ERASE CONSTRUCT? Y/N',
        when: { t: 'flag', name: 'merged' },
        complete: { t: 'flag', name: 'erased-answered' },
        optional: true,
      },
      {
        id: 'ending',
        text: 'The merge completes',
        when: { t: 'flag', name: 'merged' },
        complete: { t: 'flag', name: 'ending-a' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'approach' },
          { a: 'say', who: 'system', line: 'CORE. KUANG LIVE. FLIP. WATCH THE FEED.' },
        ],
      },
      {
        at: { t: 'near', landmark: M7_CLUSTER, radius: M7_NEAR },
        do: [{ a: 'setFlag', name: 'at-core', value: true }],
      },
      {
        at: { t: 'meatTime', s: M7_WORD_SPOKEN_AT },
        do: [{ a: 'setFlag', name: 'word-ready', value: true }],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-head' } },
        do: [{ a: 'setFlag', name: 'head-open', value: true }],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: 'straylight-word' } },
        do: [{ a: 'setFlag', name: 'word-in', value: true }],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { targetId: 'merge' } },
        do: [{ a: 'setFlag', name: 'merged', value: true }],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { targetId: 'erase' } },
        do: [{ a: 'setFlag', name: 'erased-answered', value: true }],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { targetId: 'ending-a' } },
        do: [
          { a: 'setFlag', name: 'ending-a', value: true },
          { a: 'music', state: 'silent' },
        ],
      },
    ],
    fail: [{ t: 'event', type: 'gateWindow', where: { gateId: 'word-window', state: 'missed' } }],
    checkpoints: [
      { id: 'core', at: { t: 'event', type: 'jackIn' } },
      { id: 'word', at: { t: 'flag', name: 'word-ready' } },
      { id: 'merge', at: { t: 'flag', name: 'word-in' } },
      { id: 'erase', at: { t: 'flag', name: 'merged' } },
      { id: 'epilogue', at: { t: 'flag', name: 'erased-answered' } },
    ],
  };
}
