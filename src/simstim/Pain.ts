import type { EventBus, Unsubscribe } from '../core/events';

/** Pain transfer (plan §3.7): red vignette, tinnitus, slowed frames, neural echo. */

export const PAIN_DECAY_PER_S = 0.35;
/** Neural load added on flip-back per unit of remaining pain (0..1). */
export const PAIN_ECHO_NEURAL = 8;
export const ECHO_DECAY_PER_S = 4;
export const FRAME_HOLD_MAX = 3;

export interface PainOverlay {
  /** 0..1 red-shifted vignette. */
  vignette: number;
  /** 0..1 tinnitus amplitude (pre settings.audio.pain). */
  tinnitus: number;
  /** Hold the camera this many extra sim frames (slowed feed). */
  frameHold: number;
}

export interface PainOptions {
  events: EventBus;
  /** Decay per second. */
  decay?: number;
}

export interface Pain {
  /** 0..1 current pain. */
  readonly amount: number;
  /** Flip-back EEG spike residual (neural units). */
  readonly echo: number;
  readonly overlay: PainOverlay;
  /** Last posted neural load (0..100). */
  readonly neural: number;
  reset(): void;
  /** Direct set (tests / lab). Also posted as `mollyPain`. */
  hurt(amount: number): void;
  update(dt: number): void;
  /** Call when leaving the feed. Posts `neuralChanged` if pain remains. */
  flipBack(): void;
  dispose(): void;
}

export function createPain(opts: PainOptions): Pain {
  const decay = opts.decay ?? PAIN_DECAY_PER_S;
  let amount = 0;
  let echo = 0;
  let neural = 0;
  const overlay: PainOverlay = { vignette: 0, tinnitus: 0, frameHold: 0 };

  const refreshOverlay = (): void => {
    overlay.vignette = amount;
    overlay.tinnitus = amount;
    overlay.frameHold = amount > 0.05 ? Math.min(FRAME_HOLD_MAX, 1 + Math.floor(amount * 3)) : 0;
  };

  const unsub: Unsubscribe = opts.events.on('mollyPain', (e) => {
    amount = Math.min(1, Math.max(amount, e.amount));
    refreshOverlay();
  });

  const api: Pain = {
    get amount() {
      return amount;
    },
    get echo() {
      return echo;
    },
    overlay,
    get neural() {
      return neural;
    },
    reset() {
      amount = 0;
      echo = 0;
      neural = 0;
      refreshOverlay();
    },
    hurt(next) {
      const v = Math.min(1, Math.max(0, next));
      amount = Math.max(amount, v);
      opts.events.post({ type: 'mollyPain', amount: v });
      refreshOverlay();
    },
    update(dt) {
      const d = Math.max(0, dt);
      if (amount > 0) amount = Math.max(0, amount - decay * d);
      if (echo > 0) {
        echo = Math.max(0, echo - ECHO_DECAY_PER_S * d);
        const prev = neural;
        neural = Math.max(0, neural - ECHO_DECAY_PER_S * d);
        if (neural !== prev) opts.events.post({ type: 'neuralChanged', value: neural });
      }
      refreshOverlay();
    },
    flipBack() {
      if (amount <= 0.05) return;
      const bump = amount * PAIN_ECHO_NEURAL;
      echo = bump;
      neural = Math.min(100, neural + bump);
      opts.events.post({ type: 'neuralChanged', value: neural });
    },
    dispose() {
      unsub();
    },
  };

  return api;
}
