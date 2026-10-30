import type { AudioEngine } from '../audio/AudioEngine';
import type { ModeContext } from '../app/ModeStack';
import type { InputFrame } from '../input/Input';
import { createInkRuntime, type InkRuntime, type InkStory } from '../narrative/InkRuntime';
import type { RasterCrtPass } from '../render/post/RasterCrtPass';
import type { PostMode } from '../render/post/pass';
import { paintTeletextPage, type TeletextPageId } from '../content/teletext/testCard';
import { createPhoneRing, type PhoneRingHook } from './phoneRing';
import { createTeletext, type Teletext } from './Teletext';
import type { TeletextPage } from './TeletextPage';

const CHOICE_ACTIONS = ['soft1', 'soft2', 'soft3', 'soft4'] as const;

export interface InterludeOptions {
  story: InkStory;
  audio?: Pick<AudioEngine, 'sfx' | 'unlock'>;
  phone?: PhoneRingHook;
  /** Injected renderer (node tests skip Canvas2D / WebGL). */
  teletext?: Teletext;
  /** Injected clock (tests). */
  now?: () => Date;
  /** Called whenever the displayed knot/page changes. */
  onChange?: (info: InterludeInfo) => void;
}

export interface InterludeInfo {
  knot: string;
  pageId: TeletextPageId;
  ringing: boolean;
  ended: boolean;
}

export interface Interlude {
  readonly ink: InkRuntime;
  readonly teletext: Teletext;
  readonly phone: PhoneRingHook;
  readonly page: TeletextPage;
  readonly info: InterludeInfo;
  attach(ctx: ModeContext): void;
  detach(): void;
  update(dt: number): void;
  render(): void;
  handleInput(frame: InputFrame): void;
  choose(n: number): boolean;
  dispose(): void;
}

function pageIdOf(ink: InkRuntime): TeletextPageId {
  const tag = ink.tag('page');
  if (tag === 'phone' || tag === 'text' || tag === 'test') return tag;
  return 'test';
}

/**
 * Meatspace interlude session: Ink knot → 40×24 page → Canvas2D texture
 * hung on RasterCrtPass.source with postMode `interlude`.
 */
export function createInterlude(opts: InterludeOptions): Interlude {
  const ink = createInkRuntime(opts.story);
  const teletext = opts.teletext ?? createTeletext();
  const phone = opts.phone ?? createPhoneRing();
  const now = opts.now ?? (() => new Date());
  let ctx: ModeContext | null = null;
  let savedMode: PostMode = 'matrix';
  let raster: RasterCrtPass | null = null;
  let page: TeletextPage = paintTeletextPage({
    pageId: 'test',
    clock: now(),
    lines: [],
    choices: [],
  });
  let time = 0;
  let lastSecond = -1;
  let ringingWanted = false;

  const info = (): InterludeInfo => ({
    knot: ink.state.knot,
    pageId: pageIdOf(ink),
    ringing: ringingWanted && phone.sounding(time),
    ended: ink.state.ended,
  });

  const layout = (): void => {
    const id = pageIdOf(ink);
    page = paintTeletextPage({
      pageId: id,
      clock: now(),
      lines: ink.state.text,
      choices: ink.state.choices,
      phoneSounding: phone.sounding(time),
      title: id === 'phone' ? 'WINTERMUTE' : 'CHIBA   NITE CITY',
    });
  };

  const blit = (): void => {
    teletext.paint(page, {
      time,
      reduceFlashing: ctx?.settings.value.reduceFlashing ?? false,
      phoneSounding: phone.sounding(time),
    });
    opts.onChange?.(info());
  };

  const rebuild = (): void => {
    const id = pageIdOf(ink);
    ringingWanted = ink.hasTag('ring') || id === 'test' || id === 'phone';
    if (ringingWanted) phone.start();
    else phone.stop();
    layout();
    blit();
  };

  const session: Interlude = {
    ink,
    teletext,
    phone,
    get page() {
      return page;
    },
    get info() {
      return info();
    },
    attach(next) {
      ctx = next;
      const renderer = next.renderer;
      if (renderer) {
        savedMode = renderer.postMode;
        renderer.postMode = 'interlude';
        const pass = renderer.chain.rasterCrt as RasterCrtPass;
        if (pass.slot === 'crt' && 'playTransition' in pass) {
          raster = pass;
          pass.source = teletext.texture;
          pass.playTransition();
        }
      }
      time = 0;
      lastSecond = -1;
      rebuild();
    },
    detach() {
      phone.stop();
      if (raster) {
        raster.source = null;
        raster.stopTransition();
        raster = null;
      }
      if (ctx?.renderer) ctx.renderer.postMode = savedMode;
      ctx = null;
    },
    update(dt) {
      time += dt;
      const second = now().getSeconds();
      if (second !== lastSecond) {
        lastSecond = second;
        layout();
      }
      blit();
    },
    render() {
      // Texture is updated in update(); RasterCrtPass samples it in endFrame.
    },
    handleInput(frame) {
      for (let i = 0; i < CHOICE_ACTIONS.length; i++) {
        if (frame.pressed(CHOICE_ACTIONS[i]!)) session.choose(i + 1);
      }
    },
    choose(n) {
      const ok = ink.choose(n);
      if (!ok) return false;
      opts.audio?.sfx('uiClick');
      rebuild();
      return true;
    },
    dispose() {
      session.detach();
      phone.dispose();
      teletext.dispose();
    },
  };
  return session;
}
