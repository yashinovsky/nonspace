import type { InputFrame } from '../../input/Input';
import type { Mode, ModeContext } from '../ModeStack';

export interface MatrixMode extends Mode {
  readonly live: boolean;
}

export interface MatrixModeOptions {
  onInput?: (frame: InputFrame, ctx: ModeContext) => void;
  onUpdate?: (dt: number, ctx: ModeContext) => void;
  onRender?: (alpha: number, ctx: ModeContext) => void;
}

/** In-matrix flight (M7.4 vertical slice). Simulates under DeckPanel. */
export function createMatrixMode(opts: MatrixModeOptions = {}): MatrixMode {
  let ctx: ModeContext | null = null;
  const mode: MatrixMode = {
    id: 'matrix',
    simulatesWhenCovered: true,
    get live() {
      return ctx !== null;
    },
    enter(next) {
      ctx = next;
      if (next.renderer) next.renderer.postMode = 'matrix';
    },
    exit() {
      ctx = null;
    },
    update(dt) {
      if (ctx) opts.onUpdate?.(dt, ctx);
    },
    render(alpha) {
      if (ctx) opts.onRender?.(alpha, ctx);
    },
    handleInput(frame) {
      if (ctx) opts.onInput?.(frame, ctx);
    },
  };
  return mode;
}
