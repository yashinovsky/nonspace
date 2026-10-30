/** Slot used by the 16-voice FM allocator (and any similar pool). */
export interface VoiceSlot {
  active: boolean;
  amp: number;
  startedAt: number;
}

/**
 * First idle slot, else the quietest, else the oldest. Always returns an
 * index in range; the caller marks it active.
 */
export function allocVoice(slots: VoiceSlot[], now: number): number {
  const n = slots.length;
  let idle = -1;
  let steal = 0;
  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    if (!s.active) {
      idle = i;
      break;
    }
    const cur = slots[steal]!;
    if (s.amp < cur.amp - 1e-6) steal = i;
    else if (s.amp - cur.amp <= 1e-6 && s.startedAt < cur.startedAt) steal = i;
  }
  const i = idle >= 0 ? idle : steal;
  const slot = slots[i]!;
  slot.active = true;
  slot.startedAt = now;
  return i;
}

export function countActive(slots: ReadonlyArray<Pick<VoiceSlot, 'active'>>): number {
  let n = 0;
  for (let i = 0; i < slots.length; i++) if (slots[i]!.active) n++;
  return n;
}
