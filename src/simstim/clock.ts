/** Chip-clock helpers (plan §5.8): red 7-segment `HH:MM:SS` in Molly's vision. */

const CLOCK_RE = /^(\d{2}):(\d{2}):(\d{2})$/;

export function parseClock(start: string): number {
  const m = CLOCK_RE.exec(start);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function formatClock(seconds: number): string {
  let s = Math.floor(seconds) % 86400;
  if (s < 0) s += 86400;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

export function chipClockAt(clockStart: string, meatTime: number): string {
  return formatClock(parseClock(clockStart) + meatTime);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 7-segment bit masks for 0-9 (a,b,c,d,e,f,g). */
export const SEG7 = [
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111,
  0b1101111,
] as const;
