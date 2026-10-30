/**
 * Title / jack-in prompt (plan §6.4). The first key press unlocks Web Audio.
 */

import type { AudioEngine } from '../../audio/AudioEngine';
import { el, ensureCrtStyles } from '../../hud/dom/theme';
import type { InputFrame } from '../../input/Input';
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

export function isTitleUnlockKey(key: string): boolean {
  return key.length > 0 && !SKIP_KEYS.has(key);
}

export interface TitleMode extends Mode {
  readonly unlocked: boolean;
  readonly flashingPrompt: boolean;
  readonly unlockCalls: number;
  /** Test/lab: fire the same path as a real key. */
  pressKey(key: string): void;
}

export interface TitleModeOptions {
  onJackIn?: () => void;
  /** Override audio (tests). Defaults to ModeContext.audio. */
  audio?: AudioEngine;
}

export function createTitleMode(opts: TitleModeOptions = {}): TitleMode {
  let ctx: ModeContext | null = null;
  let root: HTMLElement | null = null;
  let promptEl: HTMLElement | null = null;
  let unlocked = false;
  let unlockCalls = 0;
  let flashingPrompt = false;
  let jacked = false;
  let keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  const audio = (): AudioEngine | undefined => opts.audio ?? ctx?.audio;

  const paint = (): void => {
    if (!root || !promptEl) return;
    root.dataset.unlocked = unlocked ? '1' : '0';
    root.dataset.flashingPrompt = flashingPrompt ? '1' : '0';
    if (flashingPrompt) {
      promptEl.textContent = 'PHOTOSENSITIVITY  REDUCE FLASHING?  [Y] YES  [N] NO';
    } else {
      promptEl.textContent = 'PRESS ANY KEY TO JACK IN';
    }
    if (ctx?.settings.value.reduceFlashing) root.classList.add('ns-reduce-flash');
    else root.classList.remove('ns-reduce-flash');
  };

  const unlock = (): void => {
    unlockCalls += 1;
    unlocked = true;
    void audio()?.unlock();
  };

  const answerFlashing = (reduce: boolean): void => {
    if (!ctx || !flashingPrompt) return;
    ctx.settings.update({ reduceFlashing: reduce, flashingPromptAnswered: true });
    flashingPrompt = false;
    paint();
  };

  const pressKey = (key: string): void => {
    if (!isTitleUnlockKey(key) || jacked) return;
    unlock();
    if (flashingPrompt) {
      if (key === 'n' || key === 'N') answerFlashing(false);
      else answerFlashing(true);
      return;
    }
    jacked = true;
    opts.onJackIn?.();
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    const t = ev.target;
    if (
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }
    pressKey(ev.key);
  };

  const mode: TitleMode = {
    id: 'title',
    simulatesWhenCovered: false,
    get unlocked() {
      return unlocked;
    },
    get flashingPrompt() {
      return flashingPrompt;
    },
    get unlockCalls() {
      return unlockCalls;
    },
    pressKey,
    enter(next) {
      ctx = next;
      flashingPrompt = next.settings.value.flashingPromptAnswered !== true;
      ensureCrtStyles();
      const parent = next.renderer?.canvas.parentElement ?? document.body;
      root = el('div', { class: 'ns-crt-root', 'data-testid': 'title-screen' });
      const screen = el('div', { class: 'ns-title' });
      screen.appendChild(
        el('div', { class: 'ns-logo', 'data-testid': 'title-logo' }, 'ONO-SENDAI CYBERSPACE 7'),
      );
      promptEl = el('div', { class: 'ns-prompt', 'data-testid': 'title-prompt' });
      screen.appendChild(promptEl);
      root.appendChild(screen);
      parent.appendChild(root);
      keyHandler = onKey;
      window.addEventListener('keydown', keyHandler);
      paint();
    },
    exit() {
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
      root?.remove();
      root = null;
      promptEl = null;
      ctx = null;
    },
    update() {
      paint();
    },
    render() {},
    handleInput(frame: InputFrame) {
      if (
        frame.pressed('pause') ||
        frame.pressed('engage') ||
        frame.pressed('scan') ||
        frame.pressed('deck') ||
        frame.pressed('jackOut')
      ) {
        pressKey('Enter');
      }
    },
  };
  return mode;
}
