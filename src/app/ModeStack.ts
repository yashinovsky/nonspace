import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import type { InputFrame, InputService } from '../input/Input';
import type { MissionRunner } from '../narrative/MissionRunner';
import type { FlightController } from '../player/FlightController';
import type { Renderer } from '../render/Renderer';

/** Mode ids from plan §8.2. */
export const MODE_IDS = [
  'boot',
  'title',
  'interlude',
  'jackIn',
  'matrix',
  'breach',
  'core',
  'simstim',
  'deckPanel',
  'flatline',
  'beach',
  'jackOut',
] as const;

export type ModeId = (typeof MODE_IDS)[number];

/**
 * What modes receive in `handleInput`. M0.3 replaced the `unknown` placeholder
 * with `InputFrame`; the alias remains so older call sites still compile.
 */
export type ModeInputFrame = InputFrame;

/** Services available to modes. Later tasks append their services here; the App builds it. */
export interface ModeContext {
  readonly events: EventBus;
  readonly modes: ModeStack;
  readonly settings: SettingsStore;
  readonly save: SaveStore;
  /** M7.1. Optional so parallel tasks don't have to construct a runner. */
  readonly mission?: MissionRunner;
  /** M0.3. Optional so parallel tasks don't have to construct an Input service. */
  readonly input?: InputService;
  /** M2.5. Optional so parallel tasks don't have to construct a flight controller. */
  readonly flight?: FlightController;
  /** M0.4. Optional so unit tests stay light; the App always provides it. */
  readonly renderer?: Renderer;
}

/** Plan §8.2. Implement as a class or plain object; one instance may be on the stack at a time. */
export interface Mode {
  readonly id: ModeId;
  /** Keep updating while another mode is on top (e.g. Matrix under DeckPanel or Simstim). */
  readonly simulatesWhenCovered: boolean;
  enter(ctx: ModeContext): void;
  exit(): void;
  /** Fixed sim step (seconds). */
  update(dt: number): void;
  /** Once per frame, bottom of the stack first. `alpha` is the loop's interpolation fraction. */
  render(alpha: number): void;
  /** Top mode only, once per sim step before `update`. */
  handleInput(frame: InputFrame): void;
  /** Another mode was pushed on top of this one. */
  covered?(by: Mode): void;
  /** This mode is the top again. */
  uncovered?(): void;
}

/**
 * Stack of active modes. The top mode gets input. Below it, modes keep
 * updating down to the first one whose `simulatesWhenCovered` is false; that
 * mode and everything under it are frozen. Every mode renders, bottom first.
 *
 * Transitions requested while the stack is running a mode callback (update,
 * render, input, enter/exit, covered/uncovered) are queued and applied in
 * order once that callback returns, so a frame never sees a half-changed
 * stack. `modeChanged` is emitted whenever the top changes from one mode to
 * another (not for the first push or the final pop).
 */
export interface ModeStack {
  readonly ctx: ModeContext;
  readonly top: Mode | undefined;
  readonly size: number;
  /** Bottom first. */
  ids(): ModeId[];
  has(id: ModeId): boolean;
  /** True if the mode is on the stack and will update this step. */
  isSimulating(mode: Mode): boolean;
  push(mode: Mode): void;
  pop(): void;
  /** Swap the top mode (e.g. Boot → Title, Matrix ⇄ Breach). */
  replace(mode: Mode): void;
  /** Exit every mode, top first, then push `mode` if given (e.g. → JackOut). */
  reset(mode?: Mode): void;
  handleInput(frame: InputFrame): void;
  update(dt: number): void;
  render(alpha: number): void;
}

type Op = { kind: 'push' | 'replace' | 'reset'; mode?: Mode } | { kind: 'pop' };

export type ModeServices = Omit<ModeContext, 'modes'>;

export function createModeStack(services: ModeServices): ModeStack {
  const stack: Mode[] = [];
  const pending: Op[] = [];
  let busy = 0;

  const ctx = { ...services } as { -readonly [K in keyof ModeContext]: ModeContext[K] };

  const emitChange = (from: Mode | undefined, to: Mode | undefined): void => {
    if (from && to && from !== to) {
      services.events.emit({ type: 'modeChanged', from: from.id, to: to.id });
    }
  };

  const guard = (mode: Mode): void => {
    if (stack.includes(mode)) throw new Error(`mode '${mode.id}' is already on the stack`);
  };

  const apply = (op: Op): void => {
    const prev = stack.at(-1);
    switch (op.kind) {
      case 'push': {
        const mode = op.mode!;
        guard(mode);
        stack.push(mode);
        prev?.covered?.(mode);
        mode.enter(ctx);
        break;
      }
      case 'pop': {
        if (!prev) throw new Error('pop() on an empty mode stack');
        stack.pop();
        prev.exit();
        stack.at(-1)?.uncovered?.();
        break;
      }
      case 'replace': {
        const mode = op.mode!;
        if (prev) {
          stack.pop();
          prev.exit();
        }
        guard(mode);
        stack.push(mode);
        mode.enter(ctx);
        break;
      }
      case 'reset': {
        while (stack.length > 0) stack.pop()!.exit();
        if (op.mode) {
          stack.push(op.mode);
          op.mode.enter(ctx);
        }
        break;
      }
    }
    emitChange(prev, stack.at(-1));
  };

  const drain = (): void => {
    // Ops queued by enter/exit callbacks run after the current op, in order.
    // If a callback throws, the remaining queued ops are dropped with it.
    try {
      for (let i = 0; i < pending.length; i++) {
        busy++;
        try {
          apply(pending[i]!);
        } finally {
          busy--;
        }
      }
    } finally {
      pending.length = 0;
    }
  };

  const request = (op: Op): void => {
    pending.push(op);
    if (busy === 0) drain();
  };

  const lowestSimulating = (): number => {
    let i = stack.length - 1;
    while (i > 0 && stack[i - 1]!.simulatesWhenCovered) i--;
    return i;
  };

  const modes: ModeStack = {
    ctx,
    get top() {
      return stack.at(-1);
    },
    get size() {
      return stack.length;
    },
    ids: () => stack.map((m) => m.id),
    has: (id) => stack.some((m) => m.id === id),
    isSimulating(mode) {
      const i = stack.indexOf(mode);
      return i >= 0 && i >= lowestSimulating();
    },
    push: (mode) => request({ kind: 'push', mode }),
    pop: () => request({ kind: 'pop' }),
    replace: (mode) => request({ kind: 'replace', mode }),
    reset: (mode) => request({ kind: 'reset', mode }),
    handleInput(frame) {
      const top = stack.at(-1);
      if (!top) return;
      busy++;
      try {
        top.handleInput(frame);
      } finally {
        busy--;
      }
      if (busy === 0) drain();
    },
    update(dt) {
      if (stack.length === 0) return;
      busy++;
      try {
        for (let i = lowestSimulating(), n = stack.length; i < n; i++) stack[i]!.update(dt);
      } finally {
        busy--;
      }
      if (busy === 0) drain();
    },
    render(alpha) {
      busy++;
      try {
        for (let i = 0, n = stack.length; i < n; i++) stack[i]!.render(alpha);
      } finally {
        busy--;
      }
      if (busy === 0) drain();
    },
  };
  ctx.modes = modes;
  return modes;
}
