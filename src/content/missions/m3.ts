import type { BarkLine } from '../../companion/barks';
import type { MissionDef } from '../../narrative/schema';

/** Act II loft, same Sprawl pad as M1 (plan §4.4 / M7.6). */
export const M3_START = { region: 'BAMA', x: 164.2, z: 98.5, y: 240 } as const;
export const M3_ONBOARD_S = 8;
export const M3_ICE_ID = 'gray-hosaka';
export const M3_HOSAKA = 'hosaka-m3';
export const M3_BERNE = 'ta-berne';
export const M3_TARGET = 'armitage-db';
export const M3_RECORD = 'REC-ARMITAGE-CORTO';
export const M3_NEAR = 420;
/** First Wintermute HUD hijack (plan §4.4). Short. */
export const M3_HIJACK = 'WAIT.';

/**
 * Dixie onboarding (story bible: resigned, he knows he is dead; keep the laugh).
 * Original lines; Southern drawl. Spoken by the live companion, not the timeline.
 */
export const M3_ONBOARD: ReadonlyArray<{ at: number; line: BarkLine }> = [
  {
    at: 0.5,
    line: {
      id: 'm3-dead',
      text: "I know, boy. I died. That's the joke.",
      critical: true,
    },
  },
  {
    at: 2.4,
    line: {
      id: 'm3-plug',
      text: 'Plug me in I forget. Unplug me I forget again.',
      critical: true,
    },
  },
  {
    at: 4.4,
    line: {
      id: 'm3-laugh',
      text: 'Still got the laugh, though.',
      critical: true,
      laugh: true,
    },
  },
  {
    at: 6.4,
    line: {
      id: 'm3-teach',
      text: "Hosaka gray. Hit H, I'll read the ice.",
      critical: true,
    },
  },
];

export const M3_MIMIC_LINE: BarkLine = {
  id: 'm3-mimic',
  text: "MIMIC walks the ratio for you. Don't get cute.",
  critical: true,
  laugh: true,
};

export const M3_CORTO_LINE: BarkLine = {
  id: 'm3-corto',
  text: "Armitage is Corto. Screaming Fist. That's the man.",
  critical: true,
};

export const M3_BERNE_LINE: BarkLine = {
  id: 'm3-berne',
  text: "That's Berne. Don't touch it.",
  critical: true,
};

export const M3_BACK_LINE: BarkLine = {
  id: 'm3-back',
  text: "EEG's back. Stay off that cube.",
  critical: true,
};

/**
 * M3 — "The Construct" (plan §4.4 / M7.6).
 * Part A: H-read + MIMIC on a mid-tier Hosaka node (Armitage DB → Corto).
 * Part B: T-A Berne recon, scripted flatline (no scar), first Wintermute hijack.
 */
export function m3Mission(): MissionDef {
  return {
    id: 'm3',
    act: 2,
    title: 'The Construct',
    briefing: { ink: 'm3', knot: 'brief' },
    debrief: { ink: 'm3', knot: 'debrief' },
    start: { coords: { ...M3_START }, jackInSequence: 'short' },
    softsAvailable: ['probe', 'clamp', 'mimic', 'decoy'],
    landmarks: ['esfa', M3_HOSAKA, M3_BERNE],
    targets: [
      {
        id: M3_TARGET,
        landmark: M3_HOSAKA,
        ice: M3_ICE_ID,
        core: { seed: 11, strata: 8, targetRecord: M3_RECORD },
      },
    ],
    objectives: [
      {
        id: 'onboard',
        text: 'Hear Dixie out',
        when: { t: 'event', type: 'jackIn' },
        complete: { t: 'flag', name: 'onboarded' },
      },
      {
        id: 'hosaka',
        text: 'Punch to the Hosaka node',
        when: { t: 'flag', name: 'onboarded' },
        complete: { t: 'near', landmark: M3_HOSAKA, radius: M3_NEAR },
      },
      {
        id: 'read',
        text: 'Ask Dixie to read the ice (H)',
        when: { t: 'flag', name: 'at-hosaka' },
        complete: { t: 'event', type: 'iceEngaged', where: { iceId: M3_ICE_ID } },
      },
      {
        id: 'mimic',
        text: 'Run MIMIC',
        when: { t: 'event', type: 'iceEngaged', where: { iceId: M3_ICE_ID } },
        complete: { t: 'event', type: 'softUsed', where: { softId: 'mimic' } },
      },
      {
        id: 'crack',
        text: 'Crack the Hosaka gray ICE',
        when: { t: 'flag', name: 'at-hosaka' },
        complete: { t: 'event', type: 'iceLayerCracked', where: { iceId: M3_ICE_ID } },
      },
      {
        id: 'take',
        text: 'Pull Armitage’s database',
        when: { t: 'flag', name: 'cracked' },
        complete: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
      },
      {
        id: 'berne',
        text: 'Recon T-A Berne',
        when: { t: 'flag', name: 'got-corto' },
        complete: { t: 'near', landmark: M3_BERNE, radius: M3_NEAR },
      },
      {
        id: 'flatline',
        text: 'Survive the Berne tendril',
        when: { t: 'flag', name: 'at-berne' },
        complete: { t: 'event', type: 'flatline', where: { scripted: true } },
      },
      {
        id: 'hijack',
        text: 'Wintermute contact',
        when: { t: 'flag', name: 'berne-flat' },
        complete: { t: 'event', type: 'wintermute' },
      },
      {
        id: 'out',
        text: 'Jack out',
        when: { t: 'flag', name: 'hijacked' },
        complete: { t: 'event', type: 'jackOut' },
      },
    ],
    timeline: [
      {
        at: { t: 'event', type: 'jackIn' },
        do: [
          { a: 'music', state: 'transit' },
          { a: 'say', who: 'system', line: 'CONSTRUCT SLOTTED. ROM. MCCOY PAULEY.' },
        ],
      },
      {
        at: { t: 'time', s: M3_ONBOARD_S },
        do: [{ a: 'setFlag', name: 'onboarded', value: true }],
      },
      {
        at: { t: 'near', landmark: M3_HOSAKA, radius: M3_NEAR },
        do: [
          { a: 'setFlag', name: 'at-hosaka', value: true },
          { a: 'music', state: 'approach' },
        ],
      },
      {
        at: { t: 'event', type: 'iceEngaged', where: { iceId: M3_ICE_ID } },
        do: [{ a: 'music', state: 'breach' }],
      },
      {
        at: { t: 'event', type: 'iceLayerCracked', where: { iceId: M3_ICE_ID } },
        do: [
          { a: 'setFlag', name: 'cracked', value: true },
          { a: 'sfx', id: 'shatter' },
          { a: 'music', state: 'core' },
        ],
      },
      {
        at: { t: 'event', type: 'downloadProgress', where: { value: 1 } },
        do: [{ a: 'setFlag', name: 'got-corto', value: true }],
      },
      {
        at: { t: 'near', landmark: M3_BERNE, radius: M3_NEAR },
        do: [
          { a: 'setFlag', name: 'at-berne', value: true },
          { a: 'music', state: 'approach' },
        ],
      },
      {
        at: { t: 'event', type: 'flatline', where: { scripted: true } },
        do: [{ a: 'setFlag', name: 'berne-flat', value: true }],
      },
      {
        at: { t: 'event', type: 'wintermute' },
        do: [{ a: 'setFlag', name: 'hijacked', value: true }],
      },
    ],
    fail: [],
    checkpoints: [
      { id: 'start', at: { t: 'event', type: 'jackIn' } },
      { id: 'onboard', at: { t: 'time', s: M3_ONBOARD_S } },
      { id: 'hosaka', at: { t: 'near', landmark: M3_HOSAKA, radius: M3_NEAR } },
      { id: 'core', at: { t: 'event', type: 'iceLayerCracked', where: { iceId: M3_ICE_ID } } },
      { id: 'berne', at: { t: 'near', landmark: M3_BERNE, radius: M3_NEAR } },
      { id: 'hijack', at: { t: 'event', type: 'wintermute' } },
    ],
  };
}
