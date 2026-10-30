/**
 * DOM settings overlay (plan §6.4, §8.10). Real form controls for screen
 * readers and text scaling. Opening pauses the sim; the deck panel does not.
 */

import type { Loop } from '../../core/loop';
import type { SettingsStore } from '../../core/settings';
import {
  ACTIONS,
  AXES,
  formatSource,
  type ActionId,
  type AxisId,
  type BindTarget,
  type InputService,
} from '../../input/Input';
import { el, ensureCrtStyles } from './theme';

/** Every §8.10 control the menu MUST expose (plus the rest of the save schema). */
export const ACCESSIBILITY_FIELDS = [
  'reduceFlashing',
  'reduceMotion',
  'holdToToggle',
  'subtitles.enabled',
  'subtitles.size',
  'subtitles.background',
  'phaseLock.visualOnly',
  'phaseLock.widerTolerance',
  'phaseLock.mimicAlways',
  'phaseLock.slowerRekey',
] as const;

export type AccessibilityFieldId = (typeof ACCESSIBILITY_FIELDS)[number];

export interface SettingsMenu {
  readonly open: boolean;
  readonly pausedSim: boolean;
  mount(parent: HTMLElement): void;
  show(): void;
  hide(): void;
  toggle(): void;
  sync(): void;
  dispose(): void;
  /** Test helper: the live form has this control. */
  hasField(id: string): boolean;
}

export interface SettingsMenuOptions {
  settings: SettingsStore;
  input?: InputService;
  /** When set, `show()` / `hide()` toggle `loop.paused` (plan §6.3). */
  loop?: Pick<Loop, 'paused'>;
}

export function createSettingsMenu(opts: SettingsMenuOptions): SettingsMenu {
  ensureCrtStyles();
  const { settings } = opts;
  let root: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let mounted = false;
  let open = false;
  let unsub: (() => void) | null = null;
  let keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  const setPaused = (on: boolean): void => {
    if (opts.loop) opts.loop.paused = on;
  };

  const paint = (): void => {
    if (!body) return;
    body.replaceChildren();
    const s = settings.value;

    body.appendChild(el('div', { class: 'ns-legend' }, 'ACCESSIBILITY  §8.10'));
    boolField(body, 'reduceFlashing', 'Reduce flashing', s.reduceFlashing, (v) =>
      settings.update({ reduceFlashing: v }),
    );
    boolField(body, 'reduceMotion', 'Reduce motion', s.reduceMotion, (v) =>
      settings.update({ reduceMotion: v }),
    );
    boolField(
      body,
      'holdToToggle',
      'Hold-to-toggle (boost / fine / download / jack-out)',
      s.holdToToggle,
      (v) => settings.update({ holdToToggle: v }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'SUBTITLES'));
    boolField(body, 'subtitles.enabled', 'Subtitles', s.subtitles.enabled, (v) =>
      settings.update({ subtitles: { enabled: v } }),
    );
    choiceField(
      body,
      'subtitles.size',
      'Size',
      ['small', 'medium', 'large'],
      s.subtitles.size,
      (v) => settings.update({ subtitles: { size: v as 'small' | 'medium' | 'large' } }),
    );
    rangeField(
      body,
      'subtitles.background',
      'Background',
      s.subtitles.background,
      0,
      1,
      0.05,
      (v) => settings.update({ subtitles: { background: v } }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'PHASE LOCK ASSISTS'));
    boolField(
      body,
      'phaseLock.visualOnly',
      'Visual-only (no audio required)',
      s.phaseLock.visualOnly,
      (v) => settings.update({ phaseLock: { visualOnly: v } }),
    );
    boolField(
      body,
      'phaseLock.widerTolerance',
      'Wider tolerance',
      s.phaseLock.widerTolerance,
      (v) => settings.update({ phaseLock: { widerTolerance: v } }),
    );
    boolField(body, 'phaseLock.mimicAlways', 'MIMIC always', s.phaseLock.mimicAlways, (v) =>
      settings.update({ phaseLock: { mimicAlways: v } }),
    );
    boolField(body, 'phaseLock.slowerRekey', 'Slower re-key', s.phaseLock.slowerRekey, (v) =>
      settings.update({ phaseLock: { slowerRekey: v } }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'COLORBLIND'));
    const note = el(
      'div',
      { class: 'ns-muted', 'data-field': 'colorblind' },
      'Identity is shape and rhythm, not hue. Trace uses position (10 LEDs), not color alone.',
    );
    body.appendChild(note);

    body.appendChild(el('div', { class: 'ns-legend' }, 'DIFFICULTY'));
    choiceField(body, 'difficulty', 'Difficulty', ['story', 'normal', 'hard'], s.difficulty, (v) =>
      settings.update({ difficulty: v as 'story' | 'normal' | 'hard' }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'AUDIO'));
    rangeField(body, 'audio.master', 'Master', s.audio.master, 0, 1, 0.05, (v) =>
      settings.update({ audio: { master: v } }),
    );
    rangeField(body, 'audio.music', 'Music', s.audio.music, 0, 1, 0.05, (v) =>
      settings.update({ audio: { music: v } }),
    );
    rangeField(body, 'audio.sfx', 'SFX', s.audio.sfx, 0, 1, 0.05, (v) =>
      settings.update({ audio: { sfx: v } }),
    );
    rangeField(body, 'audio.voice', 'Voice', s.audio.voice, 0, 1, 0.05, (v) =>
      settings.update({ audio: { voice: v } }),
    );
    rangeField(body, 'audio.pain', 'Pain', s.audio.pain, 0, 1, 0.05, (v) =>
      settings.update({ audio: { pain: v } }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'INPUT'));
    rangeField(
      body,
      'input.mouseSensitivity',
      'Mouse sensitivity',
      s.input.mouseSensitivity,
      0.1,
      5,
      0.1,
      (v) => settings.update({ input: { mouseSensitivity: v } }),
    );
    boolField(body, 'input.invertY', 'Invert Y', s.input.invertY, (v) =>
      settings.update({ input: { invertY: v } }),
    );
    rangeField(
      body,
      'input.gamepadDeadzone',
      'Gamepad deadzone',
      s.input.gamepadDeadzone,
      0,
      0.5,
      0.01,
      (v) => settings.update({ input: { gamepadDeadzone: v } }),
    );

    body.appendChild(el('div', { class: 'ns-legend' }, 'GRAPHICS'));
    choiceField(
      body,
      'graphics.quality',
      'Quality',
      ['auto', 'low', 'medium', 'high'],
      s.graphics.quality,
      (v) => settings.update({ graphics: { quality: v as 'auto' | 'low' | 'medium' | 'high' } }),
    );
    boolField(
      body,
      'graphics.dynamicResolution',
      'Dynamic resolution',
      s.graphics.dynamicResolution,
      (v) => settings.update({ graphics: { dynamicResolution: v } }),
    );

    const input = opts.input;
    if (input) {
      body.appendChild(
        el('div', { class: 'ns-legend' }, 'REMAP  (click a chip, then press a key / button)'),
      );
      const hint = el(
        'div',
        { class: 'ns-muted', 'data-field': 'remap-hint' },
        'Mouse-only and gamepad-only are playable. Esc cancels a listen.',
      );
      body.appendChild(hint);
      for (const id of ACTIONS) bindRow(body, input, id, 'action');
      for (const id of AXES) bindRow(body, input, id, 'axis');
    }
  };

  const menu: SettingsMenu = {
    get open() {
      return open;
    },
    get pausedSim() {
      return opts.loop?.paused === true;
    },
    mount(parent) {
      if (mounted) return;
      ensureCrtStyles();
      root = el('div', { class: 'ns-crt-root', 'data-testid': 'settings-menu', hidden: 'true' });
      const plate = el('div', { class: 'ns-settings', role: 'dialog', 'aria-label': 'Settings' });
      const mast = el('div', { class: 'ns-mast' });
      mast.append(
        el('span', { class: 'ns-logo' }, 'ONO-SENDAI'),
        el('span', { class: 'ns-model' }, 'SETTINGS'),
      );
      body = el('div', { class: 'ns-settings-body' });
      plate.append(mast, body);
      root.appendChild(plate);
      parent.appendChild(root);
      mounted = true;
      unsub = settings.onChange(() => {
        if (open) paint();
      });
      keyHandler = (ev: KeyboardEvent) => {
        if (!open) return;
        if (ev.key === 'Escape' && !opts.input?.rebindTarget) {
          ev.preventDefault();
          menu.hide();
        }
      };
      window.addEventListener('keydown', keyHandler);
      paint();
    },
    show() {
      open = true;
      root?.removeAttribute('hidden');
      setPaused(true);
      if (mounted) paint();
    },
    hide() {
      open = false;
      root?.setAttribute('hidden', 'true');
      opts.input?.cancelRebind();
      setPaused(false);
    },
    toggle() {
      if (open) menu.hide();
      else menu.show();
    },
    sync() {
      if (open) paint();
    },
    dispose() {
      menu.hide();
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
      unsub?.();
      unsub = null;
      root?.remove();
      root = null;
      body = null;
      mounted = false;
    },
    hasField(id) {
      return !!body?.querySelector(`[data-field="${cssEscape(id)}"]`);
    },
  };
  return menu;
}

function cssEscape(id: string): string {
  return id.replace(/"/g, '\\"');
}

function boolField(
  parent: HTMLElement,
  id: string,
  label: string,
  value: boolean,
  set: (v: boolean) => void,
): void {
  const row = el('div', { class: 'ns-field', 'data-field': id });
  const lab = el('label', { for: `ns-${id}` }, label);
  const input = el('input', {
    id: `ns-${id}`,
    type: 'checkbox',
    'data-testid': `settings-${id}`,
  });
  input.checked = value;
  input.addEventListener('change', () => set(input.checked));
  row.append(lab, input);
  parent.appendChild(row);
}

function choiceField(
  parent: HTMLElement,
  id: string,
  label: string,
  values: readonly string[],
  value: string,
  set: (v: string) => void,
): void {
  const row = el('div', { class: 'ns-field', 'data-field': id });
  const lab = el('label', { for: `ns-${id}` }, label);
  const select = el('select', { id: `ns-${id}`, 'data-testid': `settings-${id}` });
  for (const v of values) {
    const opt = el('option', { value: v }, v);
    if (v === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => set(select.value));
  row.append(lab, select);
  parent.appendChild(row);
}

function rangeField(
  parent: HTMLElement,
  id: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  set: (v: number) => void,
): void {
  const row = el('div', { class: 'ns-field', 'data-field': id });
  const lab = el('label', { for: `ns-${id}` }, `${label}  ${value.toFixed(2)}`);
  const input = el('input', {
    id: `ns-${id}`,
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    'data-testid': `settings-${id}`,
  });
  input.addEventListener('input', () => {
    const n = Number(input.value);
    lab.textContent = `${label}  ${n.toFixed(2)}`;
    set(n);
  });
  row.append(lab, input);
  parent.appendChild(row);
}

function bindRow(
  parent: HTMLElement,
  input: InputService,
  id: ActionId | AxisId,
  kind: 'action' | 'axis',
): void {
  const row = el('div', { class: 'ns-field', 'data-field': `bind.${id}` });
  row.appendChild(el('label', {}, id));
  const chips = el('div', {});
  const sources =
    kind === 'action' ? input.bindings.actions[id as ActionId] : input.bindings.axes[id as AxisId];
  sources.forEach((src, slot) => {
    const chip = el(
      'button',
      { class: 'ns-bind', type: 'button', 'data-testid': `bind-${id}-${slot}` },
      formatSource(src),
    );
    if (input.rebindTarget === id) chip.dataset.listening = '1';
    chip.addEventListener('click', () => {
      input.listenRebind(id as BindTarget, slot);
      chip.dataset.listening = '1';
      chip.textContent = '…';
    });
    chips.appendChild(chip);
  });
  row.appendChild(chips);
  parent.appendChild(row);
}
