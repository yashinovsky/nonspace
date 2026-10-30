/**
 * Flip / peek / lag (plan §3.7). Pure so unit tests cover the FSM without a
 * mode stack. `T` toggles; holding past PEEK_HOLD_S peeks and releasing returns.
 */

export const PEEK_HOLD_S = 0.2;
/** Flip-back settle (plan §3.7). Controls stay soft; H-hold is the CRT's job. */
export const FLIP_BACK_LAG_S = 0.4;

export interface FlipButtons {
  pressed: boolean;
  released: boolean;
  held: number;
}

export interface FlipState {
  flipped: boolean;
  /** This press started while idle — candidate for a peek. */
  pressFromIdle: boolean;
  peeking: boolean;
  lag: number;
}

export function idleFlipState(): FlipState {
  return { flipped: false, pressFromIdle: false, peeking: false, lag: 0 };
}

/**
 * Advance the FSM by one sim step. `flipped` changing is the caller's cue to
 * push/pop Simstim and fire `simstimFlip`.
 */
export function stepFlip(state: FlipState, btn: FlipButtons, dt: number): FlipState {
  const next: FlipState = {
    flipped: state.flipped,
    pressFromIdle: state.pressFromIdle,
    peeking: state.peeking,
    lag: Math.max(0, state.lag - Math.max(0, dt)),
  };

  if (btn.pressed) {
    next.pressFromIdle = !state.flipped;
    if (!state.flipped) next.flipped = true;
    next.peeking = false;
  }

  if (next.pressFromIdle && btn.held >= PEEK_HOLD_S) next.peeking = true;

  if (btn.released) {
    if (next.peeking) {
      next.flipped = false;
      next.peeking = false;
    } else if (!next.pressFromIdle) {
      next.flipped = false;
    }
    next.pressFromIdle = false;
  }

  return next;
}

export function beginFlipLag(state: FlipState, duration = FLIP_BACK_LAG_S): FlipState {
  return { ...state, lag: duration, flipped: false, peeking: false, pressFromIdle: false };
}
