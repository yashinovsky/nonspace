import type { InputFrame } from '../../input/Input';
import type { Interlude } from '../../meat/Interlude';
import type { Mode, ModeContext } from '../ModeStack';

/** Mode wrapper around a meatspace Interlude session (plan §8.2). */
export function createInterludeMode(session: Interlude): Mode {
  return {
    id: 'interlude',
    simulatesWhenCovered: false,
    enter(ctx: ModeContext) {
      session.attach(ctx);
    },
    exit() {
      session.detach();
    },
    update(dt: number) {
      session.update(dt);
    },
    render() {
      session.render();
    },
    handleInput(frame: InputFrame) {
      session.handleInput(frame);
    },
  };
}
