/**
 * Dixie Flatline lines (M7.2 / plan §7.5, §3.5). Original writing, Southern
 * drawl, "boy" / "kid". At most one short book fragment per scene. The erase
 * Y/N prompt is a labelled design license (story bible §6.10) — in the book
 * Pauley is simply gone.
 */

export const BARK_GAP_S = 12;
export const READ_DELAY_S = 4;
export const READ_COOLDOWN_S = 20;
/** Auto-hold multiplies lock-meter drain only (fill is unchanged). */
export const AUTO_HOLD_DECAY = 0.5;
export const ERASE_PROMPT = 'ERASE CONSTRUCT? Y/N';
/** Shown next to the prompt so the license is labelled, not implied canon. */
export const ERASE_LICENSE_LABEL = 'design license';

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

export function numberWord(n: number): string {
  const i = n | 0;
  return i >= 0 && i < ONES.length ? ONES[i]! : String(i);
}

/** Plan §3.5: after 4 s he speaks the ICE a:b ("that's a three-two, kid"). */
export function formatRatioRead(a: number, b: number): string {
  return `that's a ${numberWord(a)}-${numberWord(b)}, kid`;
}

export interface BarkLine {
  id: string;
  text: string;
  critical: boolean;
  laugh?: boolean;
}

export function barkOccupancy(text: string): number {
  const n = text.length;
  const dur = 0.32 + n * 0.018;
  return dur < 0.35 ? 0.35 : dur > 1.25 ? 1.25 : dur;
}

export function iceEngagedBark(): BarkLine {
  return { id: 'ice-engaged', text: "You're in, kid. Feel for it.", critical: false };
}

export function iceTelegraphBark(): BarkLine {
  return { id: 'ice-telegraph', text: "She's gonna jump. Hold your lock.", critical: false };
}

export function iceRekeyBark(): BarkLine {
  return { id: 'ice-rekey', text: 'There she goes. Start over.', critical: false };
}

export function iceCrackedBark(): BarkLine {
  return {
    id: 'ice-cracked',
    text: "That's a layer. Don't get cute.",
    critical: false,
    laugh: true,
  };
}

export function gripStartBark(): BarkLine {
  return {
    id: 'grip-start',
    text: "Deck won't let go. Eight seconds, boy.",
    critical: true,
  };
}

export function gripEndBark(): BarkLine {
  return { id: 'grip-end', text: "You're out. Don't do that again.", critical: false };
}

export function simstimHoldBark(): BarkLine {
  return { id: 'simstim-hold', text: "I'll hold the meter. You ride.", critical: false };
}

export function readWorkingBark(): BarkLine {
  return { id: 'ice-read-wait', text: 'Give me a second, boy.', critical: true };
}

export function readResultBark(a: number, b: number): BarkLine {
  return { id: 'ice-read', text: formatRatioRead(a, b), critical: true };
}

/**
 * Dixie survived three flatlines in life. Count is this cowboy's running tally
 * (campaign hash marks), not his.
 */
export function flatlineBark(count: number): BarkLine {
  const n = count < 1 ? 1 : count | 0;
  if (n === 1) {
    return { id: 'flatline-1', text: 'One. I walked back from that, boy.', critical: true };
  }
  if (n === 2) {
    return { id: 'flatline-2', text: "That's two. I did three.", critical: true };
  }
  if (n === 3) {
    return { id: 'flatline-3', text: "Three. That's my number, kid.", critical: true };
  }
  return {
    id: `flatline-${n}`,
    text: "Ol' dead man still talking. You ain't.",
    critical: true,
    laugh: true,
  };
}

export function eraseYesBark(): BarkLine {
  return { id: 'erase-yes', text: "That's the deal, boy. Pull the plug.", critical: true };
}

export function eraseNoBark(): BarkLine {
  return { id: 'erase-no', text: "Your funeral. I'll still be here.", critical: true, laugh: true };
}

export interface BarkGate {
  t: number;
  speakingUntil: number;
  lastNormalAt: number;
}

export function createBarkGate(t = 0): BarkGate {
  return { t, speakingUntil: -1, lastNormalAt: -BARK_GAP_S };
}

export function isSpeaking(gate: BarkGate): boolean {
  return gate.t < gate.speakingUntil;
}

/** Non-critical barks need a 12 s gap; none may start while another is speaking. */
export function canStartBark(gate: BarkGate, critical: boolean): boolean {
  if (isSpeaking(gate)) return false;
  if (critical) return true;
  return gate.t - gate.lastNormalAt >= BARK_GAP_S;
}

export function markBarkStarted(gate: BarkGate, occupancy: number, critical: boolean): void {
  gate.speakingUntil = gate.t + occupancy;
  if (!critical) gate.lastNormalAt = gate.t;
}
