/**
 * Deck typing mode (plan §8.8): captures raw key text (coordinates, the
 * final word) and tells the Input service to suspend action bindings.
 */

export interface TextCaptureOptions {
  value?: string;
  maxLength?: number;
}

export interface TextCaptureDrain {
  value: string;
  inserted: string;
  backspace: number;
  enter: boolean;
  escape: boolean;
}

const DEFAULT_MAX = 64;

export interface TextCapture {
  readonly active: boolean;
  readonly value: string;
  start(opts?: TextCaptureOptions): void;
  /** Stop capturing and return the buffer. */
  stop(): string;
  pushKey(key: string, repeat: boolean): boolean;
  drain(): TextCaptureDrain;
}

export function createTextCapture(): TextCapture {
  let active = false;
  let value = '';
  let maxLength = DEFAULT_MAX;
  let inserted = '';
  let backspace = 0;
  let enter = false;
  let escape = false;

  const cap: TextCapture = {
    get active() {
      return active;
    },
    get value() {
      return value;
    },
    start(opts = {}) {
      active = true;
      value = opts.value ?? '';
      maxLength = opts.maxLength ?? DEFAULT_MAX;
      if (value.length > maxLength) value = value.slice(0, maxLength);
      inserted = '';
      backspace = 0;
      enter = false;
      escape = false;
    },
    stop() {
      active = false;
      const out = value;
      inserted = '';
      backspace = 0;
      enter = false;
      escape = false;
      return out;
    },
    pushKey(key, _repeat) {
      if (!active) return false;
      if (key === 'Escape') {
        escape = true;
        return true;
      }
      if (key === 'Enter') {
        enter = true;
        return true;
      }
      if (key === 'Backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          backspace++;
        }
        return true;
      }
      if (key.length === 1 && value.length < maxLength) {
        value += key;
        inserted += key;
        return true;
      }
      return key.length === 1 || key === 'Tab';
    },
    drain() {
      drainScratch.value = value;
      drainScratch.inserted = inserted;
      drainScratch.backspace = backspace;
      drainScratch.enter = enter;
      drainScratch.escape = escape;
      inserted = '';
      backspace = 0;
      enter = false;
      escape = false;
      return drainScratch;
    },
  };
  return cap;
}

const drainScratch: TextCaptureDrain = {
  value: '',
  inserted: '',
  backspace: 0,
  enter: false,
  escape: false,
};
