import type { InputFrame } from '../../input/Input';
import {
  canSkipJackIn,
  createJackInSequence,
  JACK_IN_SEEN_FLAG,
  type JackInSequence,
  type JackInVariant,
} from '../../render/fx/JackInSequence';
import type { Mode, ModeContext } from '../ModeStack';

const SKIP_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'NumLock',
  'ScrollLock',
]);

export interface JackInMode extends Mode {
  readonly sequence: JackInSequence;
  readonly skippable: boolean;
  readonly seen: boolean;
  seek(time: number): void;
  skip(): void;
}

export interface JackInModeOptions {
  variant?: JackInVariant;
  missionId?: string;
  /** When false, the caller already emitted `jackIn` (mission start). */
  emit?: boolean;
  onDone?: () => void;
}

export function createJackInMode(opts: JackInModeOptions = {}): JackInMode {
  const variant = opts.variant === 'short' ? 'short' : 'full';
  const sequence = createJackInSequence({ variant });
  let ctx: ModeContext | null = null;
  let seen = false;
  let finished = false;
  let keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  const markSeen = (): void => {
    if (!ctx) return;
    ctx.save.data.campaign.flags[JACK_IN_SEEN_FLAG] = true;
    ctx.save.commit();
    seen = true;
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    sequence.seek(sequence.duration);
    sequence.apply();
    markSeen();
    opts.onDone?.();
  };

  const skip = (): void => {
    if (!canSkipJackIn(seen) || finished) return;
    finish();
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat || SKIP_KEYS.has(ev.key)) return;
    const t = ev.target;
    if (
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    ) {
      return;
    }
    skip();
  };

  const mode: JackInMode = {
    id: 'jackIn',
    simulatesWhenCovered: true,
    sequence,
    get skippable() {
      return canSkipJackIn(seen) && !finished;
    },
    get seen() {
      return seen;
    },
    seek(time) {
      sequence.seek(time);
      sequence.apply();
      if (sequence.done) finish();
    },
    skip,
    enter(next) {
      ctx = next;
      finished = false;
      seen = ctx.save.data.campaign.flags[JACK_IN_SEEN_FLAG] === true;
      const renderer = next.renderer;
      if (!renderer) throw new Error('JackIn mode needs ModeContext.renderer');
      sequence.reduceFlashing = next.settings.value.reduceFlashing;
      sequence.seek(0);
      sequence.mount(renderer);
      renderer.postMode = 'matrix';
      renderer.crtCollapse = { scaleX: 1, scaleY: 1, glow: 0, fade: 1 };
      if (opts.emit !== false) {
        next.events.post({ type: 'jackIn', missionId: opts.missionId ?? '' });
      }
      keyHandler = onKey;
      window.addEventListener('keydown', keyHandler);
    },
    exit() {
      if (keyHandler) {
        window.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      sequence.unmount();
      ctx = null;
    },
    update(dt) {
      if (finished) return;
      sequence.reduceFlashing = ctx?.settings.value.reduceFlashing ?? sequence.reduceFlashing;
      sequence.update(dt);
      if (sequence.done) finish();
    },
    render() {
      sequence.apply();
    },
    handleInput(frame: InputFrame) {
      if (!mode.skippable) return;
      if (
        frame.pressed('pause') ||
        frame.pressed('engage') ||
        frame.pressed('scan') ||
        frame.pressed('deck') ||
        frame.pressed('jackOut')
      ) {
        skip();
      }
    },
  };
  return mode;
}
