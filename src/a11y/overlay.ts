/**
 * Lazy DOM overlay: settings + subtitles (plan §8.10). Default boot never
 * statically imports this chunk.
 */

import { createSettingsMenu, type SettingsMenu } from '../hud/dom/Settings';
import { createSubtitles, type Subtitles } from '../hud/dom/Subtitles';
import type { EventBus } from '../core/events';
import type { Loop } from '../core/loop';
import type { SettingsStore } from '../core/settings';
import type { InputFrame, InputService } from '../input/Input';
import { setSettingsOpener } from './host';
import { formatSpeech } from './speech';

export interface A11yOverlay {
  readonly open: boolean;
  readonly menu: SettingsMenu;
  readonly subtitles: Subtitles;
  mount(): void;
  show(): void;
  hide(): void;
  handleInput(frame: InputFrame): void;
  say(who: string, line: string): void;
  dispose(): void;
}

export interface A11yOverlayOptions {
  settings: SettingsStore;
  input: InputService;
  events: EventBus;
  loop?: Pick<Loop, 'paused'>;
  root: HTMLElement;
}

export function createA11yOverlay(opts: A11yOverlayOptions): A11yOverlay {
  const menu = createSettingsMenu({
    settings: opts.settings,
    input: opts.input,
    loop: opts.loop,
  });
  const subtitles = createSubtitles({ settings: opts.settings, events: opts.events });
  let mounted = false;

  const api: A11yOverlay = {
    get open() {
      return menu.open;
    },
    menu,
    subtitles,
    mount() {
      if (mounted) return;
      menu.mount(opts.root);
      const hasSubs = opts.root.querySelector('[data-testid="subtitles"]');
      if (!hasSubs) subtitles.mount(opts.root);
      mounted = true;
    },
    show() {
      api.mount();
      menu.show();
    },
    hide() {
      menu.hide();
    },
    handleInput(frame) {
      if (menu.open) menu.handleInput(frame);
      subtitles.sync();
    },
    say(who, line) {
      api.mount();
      subtitles.show(formatSpeech(who, line));
    },
    dispose() {
      setSettingsOpener(null);
      menu.dispose();
      subtitles.dispose();
      mounted = false;
    },
  };
  setSettingsOpener(() => api.show());
  return api;
}
