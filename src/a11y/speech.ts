/** Format DOM subtitle lines (plan §8.10). Speech and important SFX cues. */

export function formatSpeech(who: string, line: string): string {
  const name = who.trim() || 'SYSTEM';
  return `${name.toUpperCase()}> ${line}`;
}

export function formatCue(cue: string): string {
  const inner = cue.replace(/^\[/, '').replace(/\]$/, '');
  return `[${inner.toUpperCase()}]`;
}

export const SFX_CUES = {
  rekey: '[REKEY]',
  pain: '[PAIN]',
  grip: '[GRIP]',
  flatline: '[FLATLINE]',
  ice: '[ICE]',
  cracked: '[CRACKED]',
  gateHit: '[GATE]',
  gateMiss: '[GATE MISS]',
} as const;
