import type { ModeStack } from '../app/ModeStack';
import { createInterludeMode } from '../app/modes/Interlude';
import { createInterlude, type Interlude } from '../meat/Interlude';
import type { InkModule } from '../narrative/InkRuntime';
import type { Renderer } from '../render/Renderer';
import testInk from '../content/ink/teletext-test.json';

export interface TeletextLab {
  readonly interlude: Interlude;
  update(dt: number): void;
  dispose(): void;
}

/**
 * `?lab=teletext` — authentic 40×24 test card through RasterCrtPass.
 * Choices 1–4 (soft1–4) walk a tiny Ink story. Click to unlock the phone ring.
 */
export function installTeletextLab(opts: {
  renderer: Renderer;
  modes: ModeStack;
  root: HTMLElement;
}): TeletextLab {
  const hint = document.createElement('div');
  hint.dataset.testid = 'teletext-lab';
  hint.style.cssText = [
    'position:absolute',
    'left:12px',
    'top:12px',
    'z-index:2',
    'font:12px/1.4 ui-monospace,monospace',
    'color:#c8d0d8',
    'background:rgba(0,0,0,0.55)',
    'padding:8px 10px',
    'pointer-events:auto',
    'max-width:320px',
  ].join(';');
  hint.innerHTML =
    '<div>M6.4 Teletext / Interlude</div>' +
    '<div style="opacity:.75">40×24 · mosaic · double height · raster CRT</div>' +
    '<div style="opacity:.75">1–4 Ink choices · click to unlock ring</div>';

  const sync = (knot: string, pageId: string, ringing: boolean): void => {
    opts.root.dataset.knot = knot;
    opts.root.dataset.page = pageId;
    opts.root.dataset.phone = ringing ? '1' : '0';
  };

  const interlude = createInterlude({
    story: testInk as InkModule,
    onChange: (info) => sync(info.knot, info.pageId, info.ringing),
  });

  const mode = createInterludeMode(interlude);
  opts.modes.push(mode);

  const onClick = (): void => {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    void ctx.resume();
    interlude.phone.unlock(ctx);
    if (!interlude.phone.playing) interlude.phone.start();
  };
  opts.renderer.canvas.addEventListener('click', onClick);
  opts.root.appendChild(hint);

  const info = interlude.info;
  sync(info.knot, info.pageId, info.ringing);

  return {
    interlude,
    update() {},
    dispose() {
      opts.renderer.canvas.removeEventListener('click', onClick);
      hint.remove();
      opts.modes.reset();
      interlude.dispose();
      delete opts.root.dataset.knot;
      delete opts.root.dataset.page;
      delete opts.root.dataset.phone;
    },
  };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
