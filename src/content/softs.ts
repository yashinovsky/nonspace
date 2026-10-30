/** Softs (plan §9.4). Runtime: `deck/softs/{registry,effects}.ts` (M4.4). */
export type SoftEffect =
  | { kind: 'revealRatio'; seconds: number }
  | { kind: 'freezeDrift'; seconds: number; delayRekey: number }
  | { kind: 'damper'; seconds: number; feedbackMul: number }
  | { kind: 'decoy'; seconds: number; traceMul: number }
  | { kind: 'mimic'; rate: number }
  | { kind: 'kuang' };

export interface SoftDef {
  id: string;
  name: string;
  /** Uses per run; undefined = unlimited (MIMIC is still 1/layer in the registry). */
  charges?: number;
  /** Seconds between uses. */
  cooldown?: number;
  effect: SoftEffect;
  /** Campaign flag that unlocks the soft; 'start' = available from the first run (provisional). */
  unlock: string;
}

/** Default 4-slot loadout (plan §3.5 / HUD mock). */
export const DEFAULT_SOFT_SLOTS: readonly string[] = ['probe', 'clamp', 'damper', 'decoy'];

/** PROBE facet numeral, e.g. `3:2`. Dixie speech of that ratio is M7.2. */
export function ratioLabel(a: number, b: number): string {
  return `${a | 0}:${b | 0}`;
}

/** Starting values from the plan §3.5 softs table. */
export const SOFTS: readonly SoftDef[] = [
  {
    id: 'probe',
    name: 'PROBE',
    charges: 3,
    effect: { kind: 'revealRatio', seconds: 3 },
    unlock: 'start',
  },
  {
    id: 'clamp',
    name: 'CLAMP',
    cooldown: 15,
    effect: { kind: 'freezeDrift', seconds: 5, delayRekey: 5 },
    unlock: 'start',
  },
  {
    id: 'damper',
    name: 'DAMPER',
    cooldown: 30,
    effect: { kind: 'damper', seconds: 10, feedbackMul: 0.3 },
    unlock: 'start',
  },
  {
    id: 'decoy',
    name: 'DECOY',
    charges: 2,
    effect: { kind: 'decoy', seconds: 8, traceMul: 0.5 },
    unlock: 'start',
  },
  {
    id: 'mimic',
    name: 'MIMIC',
    effect: { kind: 'mimic', rate: 0.15 },
    unlock: 'act2',
  },
  {
    id: 'kuang',
    name: 'KUANG GRADE MARK ELEVEN',
    effect: { kind: 'kuang' },
    unlock: 'm5',
  }, // Story icebreaker: M7.8 owns the rib body + dive; this row is the §9.4 slot.
];

export function getSoft(id: string): SoftDef | undefined {
  return SOFTS.find((s) => s.id === id);
}
