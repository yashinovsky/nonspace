import type { InputFrame } from '../../input/Input';
import type { SimstimFeed } from '../../simstim/SimstimFeed';
import type { SimstimRenderer } from '../../render/simstim/SimstimRenderer';
import type { Mode, ModeContext } from '../ModeStack';

/**
 * Simstim overlay (plan §8.2 / §3.7). Matrix stays underneath
 * (`simulatesWhenCovered: true` on Matrix). This mode is the top while flipped
 * so it eats input; `T` toggles off / peeks via the feed FSM.
 */
export function createSimstimMode(feed: SimstimFeed, view?: SimstimRenderer | null): Mode {
  let ctx: ModeContext | null = null;

  const mode: Mode = {
    id: 'simstim',
    simulatesWhenCovered: true,
    enter(next) {
      ctx = next;
      if (!feed.flipped) feed.setFlipped(true);
    },
    exit() {
      if (feed.flipped) feed.setFlipped(false);
      ctx = null;
    },
    update() {},
    render() {
      if (!view) return;
      const sample = feed.sample();
      view.apply(sample, feed.overlay, feed.meatTime);
    },
    handleInput(frame: InputFrame) {
      const was = feed.flipped;
      feed.handleInput(frame);
      if (was && !feed.flipped) ctx?.modes.pop();
    },
  };
  return mode;
}
