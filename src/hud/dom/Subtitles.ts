/**
 * DOM subtitles (plan §6.4, §8.10). Size and background follow settings.
 * Speech and important SFX cues (`[REKEY]`) land here and in the deck LOG.
 */

import { formatSpeech, SFX_CUES } from '../../a11y/speech';
import type { EventBus, Unsubscribe } from '../../core/events';
import type { Settings, SettingsStore, SubtitleSize } from '../../core/settings';
import { el, ensureCrtStyles } from './theme';

export const SUBTITLE_SIZE_PX: Record<SubtitleSize, number> = {
  small: 14,
  medium: 20,
  large: 28,
};

export interface SubtitleLine {
  text: string;
  cue: boolean;
  t: number;
}

export interface Subtitles {
  readonly visible: string;
  readonly history: readonly SubtitleLine[];
  readonly sizePx: number;
  mount(parent: HTMLElement): void;
  show(text: string, cue?: boolean): void;
  clear(): void;
  sync(): void;
  dispose(): void;
}

export interface SubtitlesOptions {
  settings: SettingsStore;
  events?: EventBus;
  /** Seconds a line stays on screen. */
  hold?: number;
}

export function subtitleSizePx(size: SubtitleSize): number {
  return SUBTITLE_SIZE_PX[size];
}

export function createSubtitles(opts: SubtitlesOptions): Subtitles {
  ensureCrtStyles();
  const hold = opts.hold ?? 4;
  const history: SubtitleLine[] = [];
  let root: HTMLElement | null = null;
  let box: HTMLElement | null = null;
  let visible = '';
  let until = 0;
  let clock = 0;
  const unsubs: Unsubscribe[] = [];

  const applyStyle = (s: Settings): void => {
    if (!root || !box) return;
    root.hidden = !s.subtitles.enabled;
    root.dataset.size = s.subtitles.size;
    box.style.background = `rgba(0,0,0,${s.subtitles.background})`;
    box.style.fontSize = `${SUBTITLE_SIZE_PX[s.subtitles.size]}px`;
  };

  const paint = (): void => {
    if (!box) return;
    box.textContent = visible;
    box.hidden = visible === '';
  };

  const show = (text: string, cue = false): void => {
    const line: SubtitleLine = { text, cue, t: clock };
    history.push(line);
    if (history.length > 64) history.shift();
    visible = text;
    until = clock + hold;
    paint();
  };

  if (opts.events) {
    const bus = opts.events;
    unsubs.push(
      bus.on('dixieSay', (e) => {
        show(formatSpeech('dixie', e.lineId));
      }),
    );
    unsubs.push(
      bus.on('wintermute', (e) => {
        if (e.action.kind === 'hijack') show(e.action.text);
        else if (e.action.kind === 'bargain') show(formatSpeech('wintermute', e.action.offerId));
      }),
    );
    unsubs.push(
      bus.on('iceRekeyTelegraph', () => {
        show(SFX_CUES.rekey, true);
      }),
    );
    unsubs.push(
      bus.on('iceRekey', () => {
        show(SFX_CUES.rekey, true);
      }),
    );
    unsubs.push(
      bus.on('iceEngaged', () => {
        show(SFX_CUES.ice, true);
      }),
    );
    unsubs.push(
      bus.on('iceLayerCracked', () => {
        show(SFX_CUES.cracked, true);
      }),
    );
    unsubs.push(
      bus.on('mollyPain', () => {
        show(SFX_CUES.pain, true);
      }),
    );
    unsubs.push(
      bus.on('gripStart', () => {
        show(SFX_CUES.grip, true);
      }),
    );
    unsubs.push(
      bus.on('flatline', () => {
        show(SFX_CUES.flatline, true);
      }),
    );
    unsubs.push(
      bus.on('gateWindow', (e) => {
        if (e.state === 'hit') show(SFX_CUES.gateHit, true);
        else if (e.state === 'missed' || e.state === 'late') show(SFX_CUES.gateMiss, true);
      }),
    );
  }

  unsubs.push(
    opts.settings.onChange((s) => {
      applyStyle(s);
    }),
  );

  const sub: Subtitles = {
    get visible() {
      return visible;
    },
    get history() {
      return history;
    },
    get sizePx() {
      return SUBTITLE_SIZE_PX[opts.settings.value.subtitles.size];
    },
    mount(parent) {
      if (root) return;
      ensureCrtStyles();
      root = el('div', {
        class: 'ns-subtitles',
        'data-testid': 'subtitles',
        'aria-live': 'polite',
      });
      box = el('span', { 'data-testid': 'subtitles-text' });
      root.appendChild(box);
      parent.appendChild(root);
      applyStyle(opts.settings.value);
      paint();
    },
    show,
    clear() {
      visible = '';
      until = 0;
      paint();
    },
    sync() {
      clock += 1 / 60;
      if (visible && clock >= until) {
        visible = '';
        paint();
      }
      applyStyle(opts.settings.value);
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      root?.remove();
      root = null;
      box = null;
    },
  };
  return sub;
}
