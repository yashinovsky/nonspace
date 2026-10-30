import type { InputFrame } from '../../input/Input';
import {
  CRT_COLLAPSE_DURATION,
  createCrtCollapse,
  type CrtCollapse,
} from '../../render/fx/CrtCollapse';
import { IDENTITY_CRT_COLLAPSE } from '../../render/post/pass';
import type { Mode, ModeContext } from '../ModeStack';

export interface JackOutMode extends Mode {
  readonly collapse: CrtCollapse;
  seek(time: number): void;
}

export interface JackOutModeOptions {
  reason?: 'player' | 'burned' | 'script';
  /** When false, the caller already emitted `jackOut`. */
  emit?: boolean;
  onDone?: () => void;
}

export function createJackOutMode(opts: JackOutModeOptions = {}): JackOutMode {
  const collapse = createCrtCollapse(CRT_COLLAPSE_DURATION);
  let ctx: ModeContext | null = null;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    collapse.seek(collapse.duration);
    if (ctx?.renderer) collapse.apply(ctx.renderer);
    opts.onDone?.();
  };

  const mode: JackOutMode = {
    id: 'jackOut',
    simulatesWhenCovered: false,
    collapse,
    seek(time) {
      collapse.seek(time);
      if (ctx?.renderer) collapse.apply(ctx.renderer);
      if (collapse.done) finish();
    },
    enter(next) {
      ctx = next;
      finished = false;
      const renderer = next.renderer;
      if (!renderer) throw new Error('JackOut mode needs ModeContext.renderer');
      renderer.postMode = 'matrix';
      collapse.play();
      collapse.apply(renderer);
      if (opts.emit !== false) {
        next.events.post({ type: 'jackOut', reason: opts.reason ?? 'player' });
      }
    },
    exit() {
      collapse.stop();
      if (ctx?.renderer) {
        const s = ctx.renderer.crtCollapse;
        s.scaleX = IDENTITY_CRT_COLLAPSE.scaleX;
        s.scaleY = IDENTITY_CRT_COLLAPSE.scaleY;
        s.glow = IDENTITY_CRT_COLLAPSE.glow;
        s.fade = IDENTITY_CRT_COLLAPSE.fade;
      }
      ctx = null;
    },
    update(dt) {
      if (finished) return;
      collapse.update(dt);
      if (ctx?.renderer) collapse.apply(ctx.renderer);
      if (collapse.done) finish();
    },
    render() {
      if (ctx?.renderer) collapse.apply(ctx.renderer);
    },
    handleInput(_frame: InputFrame) {
      // 0.6 s analog collapse is not skippable (plan §5.9).
    },
  };
  return mode;
}
