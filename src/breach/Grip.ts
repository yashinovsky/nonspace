/** Black ICE grip (plan §3.5). 8 s to a full lock or you flatline. */
export const GRIP_SECONDS = 8;
export const GRIP_NEURAL_THRESHOLD = 60;

export type GripReason = 'neural' | 'rekey';
export type GripTick = 'idle' | 'holding' | 'timeout';

export interface Grip {
  readonly active: boolean;
  readonly remaining: number;
  readonly seconds: number;
  readonly iceId: string | null;
  readonly reason: GripReason | null;
  /** The deck won't let go (plan §3.5). Burned still forces a jack-out. */
  readonly jackOutBlocked: boolean;
  start(iceId: string, seconds?: number, reason?: GripReason): void;
  end(): void;
  /**
   * Simulated clock. Returns `timeout` once on the frame remaining hits 0,
   * then goes idle (caller is expected to flatline).
   */
  step(dt: number): GripTick;
}

/**
 * Consequence layer on top of IceModel's grip flag: countdown, jack-out lock.
 * IceModel decides *when* grip starts; this module enforces the 8 s window.
 */
export function createGrip(): Grip {
  let active = false;
  let remaining = 0;
  let seconds = GRIP_SECONDS;
  let iceId: string | null = null;
  let reason: GripReason | null = null;

  const api: Grip = {
    get active() {
      return active;
    },
    get remaining() {
      return remaining;
    },
    get seconds() {
      return seconds;
    },
    get iceId() {
      return iceId;
    },
    get reason() {
      return reason;
    },
    get jackOutBlocked() {
      return active;
    },
    start(id, secs = GRIP_SECONDS, why = 'neural') {
      if (active) return;
      active = true;
      seconds = secs > 0 ? secs : GRIP_SECONDS;
      remaining = seconds;
      iceId = id;
      reason = why;
    },
    end() {
      active = false;
      remaining = 0;
      iceId = null;
      reason = null;
    },
    step(dt) {
      if (!active) return 'idle';
      if (!(dt > 0)) return 'holding';
      remaining -= dt;
      if (remaining > 0) return 'holding';
      remaining = 0;
      active = false;
      return 'timeout';
    },
  };
  return api;
}
