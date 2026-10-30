/**
 * Deck power-on self-test (plan §6.4). Memory count, ROM checks, then Title.
 */

import type { InputFrame } from '../../input/Input';
import { el, ensureCrtStyles } from '../../hud/dom/theme';
import type { Mode, ModeContext } from '../ModeStack';
import { createTitleMode, type TitleMode } from './Title';

export interface BootStep {
  t: number;
  line: string;
}

export const BOOT_STEPS: readonly BootStep[] = [
  { t: 0, line: 'ONO-SENDAI CYBERSPACE 7' },
  { t: 0.12, line: 'POST  REV 7.1' },
  { t: 0.32, line: 'ROM   F000-FFFF     OK' },
  { t: 0.52, line: 'RAM   0000-7FFF     32768 OK' },
  { t: 0.72, line: 'RAM   8000-FFFF     32768 OK' },
  { t: 0.92, line: 'DECK  IO            OK' },
  { t: 1.12, line: 'TRODES              OK' },
  { t: 1.32, line: 'OPTICAL LINK        OK' },
  { t: 1.52, line: 'ICEBREAKER SLOT     --' },
  { t: 1.8, line: 'READY.' },
];

export const BOOT_DURATION = 2.15;

export interface BootSample {
  time: number;
  lines: string[];
  done: boolean;
}

/** CPU twin of the POST so tests can seek without DOM or rAF. */
export function sampleBoot(time: number): BootSample {
  const t = Math.max(0, time);
  const lines: string[] = [];
  for (const step of BOOT_STEPS) {
    if (t + 1e-9 >= step.t) lines.push(step.line);
  }
  return { time: t, lines, done: t >= BOOT_DURATION };
}

export interface BootMode extends Mode {
  readonly time: number;
  readonly done: boolean;
  readonly lines: readonly string[];
  seek(time: number): void;
}

export interface BootModeOptions {
  /** After POST, replace this mode with Title. Default true. */
  continueToTitle?: boolean;
  onDone?: () => void;
  onJackIn?: () => void;
}

export function createBootMode(opts: BootModeOptions = {}): BootMode {
  let ctx: ModeContext | null = null;
  let root: HTMLElement | null = null;
  let pre: HTMLElement | null = null;
  let time = 0;
  let finished = false;
  let lines: string[] = [];

  const paint = (): void => {
    if (!pre) return;
    pre.textContent = lines.join('\n');
    if (root) {
      root.dataset.bootTime = time.toFixed(2);
      root.dataset.bootDone = finished ? '1' : '0';
    }
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    const sample = sampleBoot(BOOT_DURATION);
    lines = sample.lines.slice();
    paint();
    opts.onDone?.();
    if (opts.continueToTitle !== false && ctx) {
      const title: TitleMode = createTitleMode({ onJackIn: opts.onJackIn });
      ctx.modes.replace(title);
    }
  };

  const apply = (t: number): void => {
    const sample = sampleBoot(t);
    time = sample.time;
    lines = sample.lines.slice();
    paint();
    if (sample.done) finish();
  };

  const mode: BootMode = {
    id: 'boot',
    simulatesWhenCovered: false,
    get time() {
      return time;
    },
    get done() {
      return finished;
    },
    get lines() {
      return lines;
    },
    seek(t) {
      apply(t);
    },
    enter(next) {
      ctx = next;
      ensureCrtStyles();
      const parent = next.renderer?.canvas.parentElement ?? document.body;
      root = el('div', {
        class: 'ns-crt-root',
        'data-testid': 'boot-post',
      });
      const screen = el('div', { class: 'ns-boot' });
      pre = el('pre', { class: 'ns-post', 'data-testid': 'boot-lines' });
      screen.appendChild(pre);
      root.appendChild(screen);
      parent.appendChild(root);
      apply(0);
    },
    exit() {
      root?.remove();
      root = null;
      pre = null;
      ctx = null;
    },
    update(dt) {
      if (finished) return;
      apply(time + Math.max(0, dt));
    },
    render() {},
    handleInput(_frame: InputFrame) {},
  };
  return mode;
}
