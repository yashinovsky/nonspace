/**
 * Dev route `?lab=deck` (M3.3). Deck panel, DOM settings/subtitles, boot POST
 * and title unlock. Lazy `?lab=` chunk — default boot never fetches it.
 *
 * Query: `&scene=deck|title|boot|settings`. No live 1080p spin; e2e freezes
 * `setAnimationLoop` and paints DOM / `endFrame` without rAF.
 */

import { createNoopAudioEngine, type AudioEngine } from '../audio/AudioEngine';
import { createBootMode, sampleBoot, type BootMode } from '../app/modes/Boot';
import { createDeckPanelMode, type DeckPanelMode } from '../app/modes/DeckPanel';
import { createTitleMode, type TitleMode } from '../app/modes/Title';
import type { Mode, ModeStack } from '../app/ModeStack';
import type { EventBus } from '../core/events';
import type { Loop } from '../core/loop';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import { createSettingsMenu, type SettingsMenu } from '../hud/dom/Settings';
import { createSubtitles, type Subtitles } from '../hud/dom/Subtitles';
import type { InputService } from '../input/Input';
import type { Renderer } from '../render/Renderer';
import { el, ensureCrtStyles } from '../hud/dom/theme';

export const DECK_SCENES = ['deck', 'title', 'boot', 'settings'] as const;
export type DeckScene = (typeof DECK_SCENES)[number];

export function isDeckScene(value: string | null | undefined): value is DeckScene {
  return (DECK_SCENES as readonly string[]).includes(value ?? '');
}

export interface DeckLab {
  update(dt: number): void;
  dispose(): void;
}

export interface DeckLabHandle {
  scene: DeckScene;
  open: boolean;
  tab: string;
  capturing: boolean;
  coordValue: string;
  lastError: string | null;
  lastJump: string | null;
  paused: boolean;
  simTicks: number;
  unlockCalls: number;
  subtitleText: string;
  subtitleSizePx: number;
  bootLines: readonly string[];
  show(scene: DeckScene): void;
  setTab(tab: string): void;
  openDeck(): void;
  closeDeck(): void;
  showSettings(): void;
  hideSettings(): void;
  showSubtitle(text: string): void;
  seekBoot(time: number): void;
  pressTitleKey(key: string): void;
  /** Paint HUD/DOM without rAF (loop frozen). */
  update(dt: number): void;
}

declare global {
  interface Window {
    __nonspaceDeck?: DeckLabHandle;
  }
}

export interface DeckLabOptions {
  renderer: Renderer;
  modes: ModeStack;
  events: EventBus;
  settings: SettingsStore;
  save: SaveStore;
  input: InputService;
  loop: Loop;
  root: HTMLElement;
  scene?: string | null;
}

const CSS = [
  'position:fixed',
  'inset:auto 0.6rem 0.6rem auto',
  'pointer-events:auto',
  'font:11px/1.35 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:50',
  'background:rgba(0,0,0,0.55)',
  'padding:0.45rem 0.6rem',
  'border:1px solid #1a3348',
  'letter-spacing:0.12em',
].join(';');

export function installDeckLab(opts: DeckLabOptions): DeckLab {
  ensureCrtStyles();
  const { renderer, modes, events, settings, save, input, loop, root } = opts;
  renderer.postMode = 'matrix';
  renderer.pipEnabled = false;
  renderer.vectorLoad = 0;

  settings.update({ flashingPromptAnswered: true });

  let unlockCalls = 0;
  const inner = createNoopAudioEngine();
  const audio: AudioEngine = {
    ...inner,
    unlock: async () => {
      unlockCalls += 1;
      return inner.unlock();
    },
  };
  Object.assign(modes.ctx, { audio });

  const settingsMenu: SettingsMenu = createSettingsMenu({ settings, input, loop });
  settingsMenu.mount(root);
  const subtitles: Subtitles = createSubtitles({ settings, events });
  subtitles.mount(root);

  let simTicks = 0;
  let deckMode: DeckPanelMode | null = null;
  let titleMode: TitleMode | null = null;
  let bootMode: BootMode | null = null;
  let scene: DeckScene = isDeckScene(opts.scene) ? opts.scene : 'deck';

  const matrixStub: Mode = {
    id: 'matrix',
    simulatesWhenCovered: true,
    enter() {},
    exit() {},
    update() {
      simTicks += 1;
    },
    render() {},
    handleInput(frame) {
      if (frame.pressed('deck')) openDeck();
      if (frame.pressed('pause')) settingsMenu.show();
    },
  };

  const closeDeck = (): void => {
    if (modes.has('deckPanel')) modes.pop();
    deckMode = null;
  };

  const openDeck = (): void => {
    if (modes.has('deckPanel')) return;
    deckMode = createDeckPanelMode({
      input,
      events,
      campaign: () => save.data.campaign,
      onSettings: () => settingsMenu.show(),
      onClose: () => {
        if (modes.has('deckPanel') && modes.top?.id === 'deckPanel') {
          /* pop happens in mode handleInput */
        }
      },
    });
    modes.push(deckMode);
  };

  const show = (next: DeckScene): void => {
    scene = next;
    settingsMenu.hide();
    modes.reset();
    deckMode = null;
    titleMode = null;
    bootMode = null;
    if (next === 'title') {
      titleMode = createTitleMode();
      modes.push(titleMode);
    } else if (next === 'boot') {
      bootMode = createBootMode({ continueToTitle: false });
      modes.push(bootMode);
    } else {
      modes.push(matrixStub);
      if (next === 'deck') openDeck();
      if (next === 'settings') settingsMenu.show();
    }
    root.dataset.scene = next;
  };

  const overlay = el('div', { 'data-testid': 'deck-lab' });
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="letter-spacing:0.28em;color:#6a8aaa;margin:0 0 0.25rem">DECK · M3.3</div>
    <div data-testid="deck-lab-stats" style="color:#6a8aaa"></div>
  `;
  root.appendChild(overlay);
  const stats = overlay.querySelector('[data-testid="deck-lab-stats"]')!;

  const handle: DeckLabHandle = {
    get scene() {
      return scene;
    },
    get open() {
      return deckMode?.panel.open === true;
    },
    get tab() {
      return deckMode?.panel.tab ?? '';
    },
    get capturing() {
      return deckMode?.panel.capturing === true;
    },
    get coordValue() {
      return deckMode?.panel.coordValue ?? '';
    },
    get lastError() {
      return deckMode?.panel.lastError ?? null;
    },
    get lastJump() {
      const j = deckMode?.panel.lastJump;
      return j ? `${j.region} ${j.x}/${j.z}/${j.y}` : null;
    },
    get paused() {
      return loop.paused;
    },
    get simTicks() {
      return simTicks;
    },
    get unlockCalls() {
      return unlockCalls;
    },
    get subtitleText() {
      return subtitles.visible;
    },
    get subtitleSizePx() {
      return subtitles.sizePx;
    },
    get bootLines() {
      return bootMode?.lines ?? sampleBoot(bootMode?.time ?? 0).lines;
    },
    show,
    setTab(tab) {
      const id = tab.toUpperCase();
      if (id === 'COORD' || id === 'SOFTS' || id === 'LOG' || id === 'PING' || id === 'STATUS') {
        deckMode?.panel.setTab(id);
      }
    },
    openDeck,
    closeDeck,
    showSettings() {
      settingsMenu.show();
    },
    hideSettings() {
      settingsMenu.hide();
    },
    showSubtitle(text) {
      subtitles.show(text);
    },
    seekBoot(time) {
      bootMode?.seek(time);
    },
    pressTitleKey(key) {
      titleMode?.pressKey(key);
    },
    update(dt) {
      subtitles.sync();
      if (settingsMenu.open) settingsMenu.sync();
      if (dt > 0) {
        /* sim ticks come from ModeStack.update via the app loop */
      }
      stats.textContent = `${scene}  deck ${handle.open ? 'open' : 'shut'}  pause ${loop.paused ? 1 : 0}  ticks ${simTicks}`;
      root.dataset.deckOpen = handle.open ? '1' : '0';
      root.dataset.paused = loop.paused ? '1' : '0';
      root.dataset.tab = handle.tab;
      root.dataset.unlocks = String(handle.unlockCalls);
    },
  };

  window.__nonspaceDeck = handle;
  root.dataset.lab = 'deck';
  show(scene);
  handle.update(0);

  return {
    update(dt) {
      handle.update(dt);
    },
    dispose() {
      settingsMenu.dispose();
      subtitles.dispose();
      overlay.remove();
      modes.reset();
      if (window.__nonspaceDeck === handle) delete window.__nonspaceDeck;
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.deckOpen;
      delete root.dataset.paused;
      delete root.dataset.tab;
      delete root.dataset.unlocks;
    },
  };
}
