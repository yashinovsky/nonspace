/**
 * Dev route `?lab=jack` (M2.7). Jack-in (full 5.5 s / short 1.2 s) and
 * jack-out CRT collapse (0.6 s). Query: `?lab=jack&seq=full|short&scene=in|out`.
 * `&first=1` clears the seen flag so skip is disabled.
 */

import { createJackInMode, type JackInMode } from '../app/modes/JackIn';
import { createJackOutMode, type JackOutMode } from '../app/modes/JackOut';
import type { ModeStack } from '../app/ModeStack';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import {
  JACK_IN_SEEN_FLAG,
  jackInDuration,
  sampleJackIn,
  type JackInVariant,
} from '../render/fx/JackInSequence';
import { sampleCrtCollapse, CRT_COLLAPSE_DURATION } from '../render/fx/CrtCollapse';
import type { Renderer } from '../render/Renderer';

export const JACK_SCENES = ['in', 'out'] as const;
export type JackScene = (typeof JACK_SCENES)[number];

export function isJackScene(value: string | null): value is JackScene {
  return (JACK_SCENES as readonly string[]).includes(value ?? '');
}

export function parseJackVariant(value: string | null | undefined): JackInVariant {
  return value === 'short' ? 'short' : 'full';
}

export interface JackLab {
  update(dt: number): void;
  dispose(): void;
}

export interface JackLabHandle {
  scene: JackScene;
  variant: JackInVariant;
  time: number;
  duration: number;
  phase: string;
  skippable: boolean;
  seen: boolean;
  done: boolean;
  collapse: { scaleX: number; scaleY: number; glow: number; fade: number };
  seek(time: number): void;
  playIn(variant?: JackInVariant): void;
  playOut(): void;
  sampleAt(time: number): ReturnType<typeof sampleJackIn>;
  sampleCollapseAt(time: number): ReturnType<typeof sampleCrtCollapse>;
}

export interface JackLabOptions {
  renderer: Renderer;
  modes: ModeStack;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  root: HTMLElement;
  seq?: string | null;
  scene?: string | null;
  first?: string | null;
}

declare global {
  interface Window {
    __nonspaceJack?: JackLabHandle;
  }
}

const CSS = [
  'position:fixed',
  'inset:0',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:20',
].join(';');

const PANEL = [
  'position:absolute',
  'pointer-events:auto',
  'left:1rem',
  'top:1rem',
  'min-width:18rem',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #1a3348',
].join(';');

const BTN =
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer;margin:0 0.3rem 0.3rem 0';

export function installJackLab(opts: JackLabOptions): JackLab {
  const { renderer, modes, save, settings, root } = opts;
  let variant = parseJackVariant(opts.seq);
  const sceneParam = opts.scene ?? null;
  let scene: JackScene = isJackScene(sceneParam) ? sceneParam : 'in';
  let jackIn: JackInMode | null = null;
  let jackOut: JackOutMode | null = null;

  if (opts.first === '1' || opts.first === 'true') {
    delete save.data.campaign.flags[JACK_IN_SEEN_FLAG];
    save.commit();
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="jack-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">JACK · M2.7</div>
      <div data-testid="jack-stats" style="color:#c8e4ff;margin:0 0 0.45rem;font-size:12px;white-space:pre"></div>
      <div>
        <button type="button" data-act="full" style="${BTN}">full 5.5s</button>
        <button type="button" data-act="short" style="${BTN}">short 1.2s</button>
        <button type="button" data-act="out" style="${BTN}">jack out</button>
      </div>
      <div style="color:#6a8aaa;font-size:11px;margin-top:0.35rem">any key skips after first viewing</div>
    </div>
  `;
  root.appendChild(overlay);
  const statsEl = overlay.querySelector('[data-testid="jack-stats"]') as HTMLElement;

  const syncHud = (): void => {
    const duration = scene === 'out' ? CRT_COLLAPSE_DURATION : jackInDuration(variant);
    const time = scene === 'out' ? (jackOut?.collapse.time ?? 0) : (jackIn?.sequence.time ?? 0);
    const phase =
      scene === 'out'
        ? jackOut?.collapse.done
          ? 'done'
          : 'collapse'
        : (jackIn?.sequence.sample.phase ?? 'black');
    const skippable = jackIn?.skippable ?? false;
    statsEl.textContent = [
      `${scene === 'out' ? 'OUT' : 'IN'}  ${variant}  t ${time.toFixed(2)}/${duration.toFixed(1)}`,
      `phase ${phase}  skip ${skippable ? 'yes' : 'no'}  seen ${jackIn?.seen ? 'yes' : 'no'}`,
    ].join('\n');
    root.dataset.lab = 'jack';
    root.dataset.jackScene = scene;
    root.dataset.jackVariant = variant;
    root.dataset.jackPhase = phase;
    root.dataset.jackTime = time.toFixed(3);
    root.dataset.jackDuration = String(duration);
    root.dataset.jackSkippable = skippable ? '1' : '0';
    root.dataset.jackSeen = jackIn?.seen ? '1' : '0';
    root.dataset.jackDone = (scene === 'out' ? jackOut?.collapse.done : jackIn?.sequence.done)
      ? '1'
      : '0';
  };

  const playIn = (nextVariant: JackInVariant = variant): void => {
    variant = nextVariant;
    scene = 'in';
    jackOut = null;
    jackIn = createJackInMode({
      variant,
      missionId: 'lab-jack',
      emit: true,
    });
    modes.reset(jackIn);
    syncHud();
  };

  const playOut = (): void => {
    scene = 'out';
    if (!jackIn || !modes.has('jackIn')) {
      jackIn = createJackInMode({ variant, missionId: 'lab-jack', emit: false });
      modes.reset(jackIn);
      jackIn.seek(jackIn.sequence.duration);
    }
    if (!modes.has('jackOut')) {
      jackOut = createJackOutMode({ reason: 'player', emit: true });
      modes.push(jackOut);
    }
    syncHud();
  };

  overlay.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).dataset.act;
    if (act === 'full') playIn('full');
    else if (act === 'short') playIn('short');
    else if (act === 'out') playOut();
  });

  const handle: JackLabHandle = {
    get scene() {
      return scene;
    },
    get variant() {
      return variant;
    },
    get time() {
      return scene === 'out' ? (jackOut?.collapse.time ?? 0) : (jackIn?.sequence.time ?? 0);
    },
    get duration() {
      return scene === 'out' ? CRT_COLLAPSE_DURATION : jackInDuration(variant);
    },
    get phase() {
      return scene === 'out'
        ? jackOut?.collapse.done
          ? 'done'
          : 'collapse'
        : (jackIn?.sequence.sample.phase ?? 'black');
    },
    get skippable() {
      return jackIn?.skippable ?? false;
    },
    get seen() {
      return jackIn?.seen ?? save.data.campaign.flags[JACK_IN_SEEN_FLAG] === true;
    },
    get done() {
      return scene === 'out' ? (jackOut?.collapse.done ?? false) : (jackIn?.sequence.done ?? false);
    },
    get collapse() {
      return { ...renderer.crtCollapse };
    },
    seek(time) {
      if (scene === 'out') jackOut?.seek(time);
      else jackIn?.seek(time);
      syncHud();
    },
    playIn,
    playOut,
    sampleAt(time) {
      return sampleJackIn(time, jackInDuration(variant), settings.value.reduceFlashing);
    },
    sampleCollapseAt(time) {
      return sampleCrtCollapse(time);
    },
  };
  window.__nonspaceJack = handle;

  if (scene === 'out') playOut();
  else playIn(variant);

  return {
    update() {
      syncHud();
    },
    dispose() {
      overlay.remove();
      if (window.__nonspaceJack === handle) delete window.__nonspaceJack;
    },
  };
}
