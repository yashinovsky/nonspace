import type { StorageLike } from '../core/save';
import { browserStorage } from '../core/save';
import type { SettingsStore } from '../core/settings';
import {
  ACTIONS,
  AXES,
  BINDINGS_KEY,
  defaultBindings,
  isHoldAction,
  loadBindings,
  rebind as applyRebind,
  saveBindings,
  sourceId,
  sourceSign,
  type ActionId,
  type AxisId,
  type BindingSet,
  type BindingSource,
  type BindTarget,
} from './bindings';
import {
  axisDeadzone,
  buttonPressed,
  buttonValue,
  pickGamepad,
  radialDeadzone,
  type GamepadSnapshot,
} from './gamepad';
import { createPointerLock, type PointerLockControl } from './pointerLock';
import { createTextCapture, type TextCaptureOptions } from './textCapture';

const ACTION_COUNT = ACTIONS.length;
const ACTION_INDEX = Object.fromEntries(ACTIONS.map((id, i) => [id, i])) as Record<
  ActionId,
  number
>;

export type { ActionId, AxisId, BindingSet, BindingSource, BindTarget };
export {
  ACTIONS,
  AXES,
  BINDINGS_KEY,
  HOLD_ACTIONS,
  Pad,
  defaultBindings,
  formatSource,
  gamepadOnlyPlayable,
  mouseOnlyPlayable,
  isActionId,
  isAxisId,
  parseBindings,
} from './bindings';

/**
 * Snapshot of one sim tick. Valid until the next `sample()`; do not retain a
 * reference across ticks. Modes consume actions, never raw keys (plan §8.8).
 *
 * `mouseDx` / `mouseDy` are pointer-lock pixel deltas this tick, already
 * multiplied by `settings.input.mouseSensitivity`, with invert-Y applied.
 * Stick/key axes are in [-1, 1] after `settings.input.gamepadDeadzone`.
 */
export interface InputFrame {
  readonly tick: number;
  readonly dt: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly mouseDx: number;
  readonly mouseDy: number;
  readonly thrust: number;
  readonly strafe: number;
  readonly vertical: number;
  readonly knobX: number;
  readonly knobY: number;
  down(action: ActionId): boolean;
  pressed(action: ActionId): boolean;
  released(action: ActionId): boolean;
  /** Seconds continuously down; 0 if up. */
  held(action: ActionId): number;
  readonly pointerLocked: boolean;
  readonly gamepadConnected: boolean;
  readonly capturingText: boolean;
  readonly textValue: string;
  readonly textInserted: string;
  readonly textBackspace: number;
  readonly textEnter: boolean;
  readonly textEscape: boolean;
}

class Frame implements InputFrame {
  tick = 0;
  dt = 0;
  lookX = 0;
  lookY = 0;
  mouseDx = 0;
  mouseDy = 0;
  thrust = 0;
  strafe = 0;
  vertical = 0;
  knobX = 0;
  knobY = 0;
  pointerLocked = false;
  gamepadConnected = false;
  capturingText = false;
  textValue = '';
  textInserted = '';
  textBackspace = 0;
  textEnter = false;
  textEscape = false;
  readonly _down = new Uint8Array(ACTION_COUNT);
  readonly _pressed = new Uint8Array(ACTION_COUNT);
  readonly _released = new Uint8Array(ACTION_COUNT);
  readonly _held = new Float32Array(ACTION_COUNT);

  down(action: ActionId): boolean {
    return this._down[ACTION_INDEX[action]] !== 0;
  }
  pressed(action: ActionId): boolean {
    return this._pressed[ACTION_INDEX[action]] !== 0;
  }
  released(action: ActionId): boolean {
    return this._released[ACTION_INDEX[action]] !== 0;
  }
  held(action: ActionId): number {
    return this._held[ACTION_INDEX[action]]!;
  }
}

export interface InputService {
  /** Last sampled frame (zeros before the first sample). */
  readonly frame: InputFrame;
  sample(dt: number): InputFrame;
  beginTextCapture(opts?: TextCaptureOptions): void;
  endTextCapture(): string;
  readonly capturingText: boolean;
  readonly bindings: Readonly<BindingSet>;
  /** Replace one slot (or append) and persist. Colliding sources are stolen. */
  rebind(target: BindTarget, source: BindingSource, slot?: number): void;
  /** Next physical key/button/axis becomes `target`'s slot. Esc cancels. */
  listenRebind(target: BindTarget, slot?: number): void;
  readonly rebindTarget: BindTarget | null;
  cancelRebind(): void;
  resetBindings(): void;
  requestPointerLock(): void;
  exitPointerLock(): void;
  readonly pointerLocked: boolean;
  /** Test helpers: feed events without a browser. */
  feedKey(code: string, down: boolean, key?: string): void;
  feedMouseButton(button: number, down: boolean): void;
  feedMouseMove(dx: number, dy: number): void;
  feedWheel(deltaY: number): void;
  setGamepads(pads: Array<GamepadSnapshot | null> | null): void;
  setPointerLocked(locked: boolean, userUnlock?: boolean): void;
  dispose(): void;
}

export interface InputOptions {
  settings: SettingsStore;
  /** Canvas (or other element) that click-to-lock attaches to. */
  target?: HTMLElement | null;
  /** Attach window/document listeners. Defaults to true when `target` is set. */
  attach?: boolean;
  storage?: StorageLike | null;
  bindingsKey?: string;
  pointerLock?: PointerLockControl;
  document?: Document;
  window?: Window;
  getGamepads?: () => ArrayLike<GamepadSnapshot | Gamepad | null>;
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return FORM_TAGS.has(target.tagName) || target.isContentEditable;
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function codeKey(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code === 'Space') return ' ';
  if (code === 'Escape') return 'Escape';
  if (code === 'Enter') return 'Enter';
  if (code === 'Backspace') return 'Backspace';
  if (code === 'Tab') return 'Tab';
  return code;
}

const ZERO2 = { x: 0, y: 0 };

type PointerLockWithFake = PointerLockControl & {
  setLocked?: (v: boolean, userUnlock?: boolean) => void;
};

export function createInput(opts: InputOptions): InputService {
  const settings = opts.settings;
  const storage =
    opts.storage === undefined
      ? typeof window === 'undefined'
        ? null
        : browserStorage()
      : opts.storage;
  const bindingsKey = opts.bindingsKey ?? BINDINGS_KEY;
  const pointer: PointerLockWithFake =
    opts.pointerLock ?? createPointerLock({ document: opts.document });
  const text = createTextCapture();
  const win = opts.window;
  const doc = opts.document;

  let bindings = loadBindings(storage, bindingsKey);
  const keysDown = new Set<string>();
  const mouseButtons = new Set<number>();
  const sticky = new Uint8Array(ACTION_COUNT);
  const prevDown = new Uint8Array(ACTION_COUNT);
  const prevPhysical = new Uint8Array(ACTION_COUNT);
  const heldTime = new Float32Array(ACTION_COUNT);
  const boundCodes = new Set<string>();
  const rebindIgnore = new Set<string>();

  let tick = 0;
  let rebindTarget: BindTarget | null = null;
  let rebindSlot = 0;
  let gamepadOverride: Array<GamepadSnapshot | null> | null = null;
  let extraMouseDx = 0;
  let extraMouseDy = 0;
  let wheelY = 0;
  let attached = false;
  let escapeFromUnlock = false;

  const frames = [new Frame(), new Frame()] as const;
  let front = 0;

  const rebuildBoundCodes = (): void => {
    boundCodes.clear();
    for (const id of ACTIONS) {
      for (const s of bindings.actions[id]) if (s.type === 'key') boundCodes.add(s.code);
    }
    for (const id of AXES) {
      for (const s of bindings.axes[id]) if (s.type === 'key') boundCodes.add(s.code);
    }
  };
  rebuildBoundCodes();

  const persist = (): void => {
    saveBindings(storage, bindings, bindingsKey);
    rebuildBoundCodes();
  };

  const readPad = (): GamepadSnapshot | null => {
    if (gamepadOverride) return pickGamepad(gamepadOverride);
    if (opts.getGamepads) return pickGamepad(opts.getGamepads());
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      return pickGamepad(navigator.getGamepads());
    }
    return null;
  };

  const sourcePhysical = (s: BindingSource, pad: GamepadSnapshot | null): boolean => {
    switch (s.type) {
      case 'key':
        return keysDown.has(s.code);
      case 'mouseButton':
        return mouseButtons.has(s.button);
      case 'gamepadButton':
        return pad ? buttonPressed(pad.buttons, s.index) : false;
      default:
        return false;
    }
  };

  const snapshotHeldSources = (): void => {
    rebindIgnore.clear();
    for (const code of keysDown) rebindIgnore.add(sourceId({ type: 'key', code }));
    for (const button of mouseButtons) rebindIgnore.add(sourceId({ type: 'mouseButton', button }));
    const pad = readPad();
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length; i++) {
      if (buttonPressed(pad.buttons, i))
        rebindIgnore.add(sourceId({ type: 'gamepadButton', index: i }));
    }
  };

  const maybeCaptureRebind = (source: BindingSource): boolean => {
    if (!rebindTarget) return false;
    if (source.type === 'key' && source.code === 'Escape') {
      rebindTarget = null;
      rebindIgnore.clear();
      return true;
    }
    const id = sourceId(source);
    if (rebindIgnore.has(id)) return false;
    bindings = applyRebind(bindings, rebindTarget, source, rebindSlot);
    persist();
    rebindTarget = null;
    rebindIgnore.clear();
    return true;
  };

  const pollGamepadRebind = (): void => {
    if (!rebindTarget) return;
    const pad = readPad();
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length; i++) {
      if (buttonPressed(pad.buttons, i)) {
        maybeCaptureRebind({ type: 'gamepadButton', index: i });
        return;
      }
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i] ?? 0;
      if (Math.abs(v) > 0.6) {
        maybeCaptureRebind({
          type: 'gamepadAxis',
          index: i,
          sign: v < 0 ? -1 : 1,
        });
        return;
      }
    }
  };

  const feedKeyDown = (code: string, key: string, repeat: boolean): void => {
    if (rebindTarget && !repeat) {
      maybeCaptureRebind({ type: 'key', code });
      keysDown.add(code);
      return;
    }
    if (text.active) {
      text.pushKey(key, repeat);
      keysDown.add(code);
      return;
    }
    keysDown.add(code);
  };

  const addAxis = (sums: AxisSums, id: AxisId, analogPart: number): void => {
    sums[id] += analogPart;
  };

  const service: InputService = {
    get frame() {
      return frames[front]!;
    },
    get capturingText() {
      return text.active;
    },
    get bindings() {
      return bindings;
    },
    get rebindTarget() {
      return rebindTarget;
    },
    get pointerLocked() {
      return pointer.locked;
    },
    sample(dt) {
      tick++;
      pollGamepadRebind();
      const back = 1 - front;
      const f = frames[back]!;
      const cfg = settings.value.input;
      const holdToToggle = settings.value.holdToToggle;
      const pad = readPad();
      const capturing = text.active;
      const ySign = cfg.invertY ? 1 : -1;
      const dz = cfg.gamepadDeadzone;

      const mouse = pointer.consumeDelta();
      const mdX = (mouse.dx + extraMouseDx) * cfg.mouseSensitivity;
      const mdY = (mouse.dy + extraMouseDy) * cfg.mouseSensitivity;
      extraMouseDx = 0;
      extraMouseDy = 0;
      const wheelThisTick = wheelY;
      wheelY = 0;

      if (pointer.consumeUserUnlock() && !capturing && !rebindTarget) {
        // Esc while locked is eaten by the browser; treat unlock as pause.
        keysDown.add('Escape');
        escapeFromUnlock = true;
      }

      const left = pad ? radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, dz) : ZERO2;
      const right = pad ? radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, dz) : ZERO2;

      const sums: AxisSums = {
        lookX: 0,
        lookY: 0,
        thrust: 0,
        strafe: 0,
        vertical: 0,
        knobX: 0,
        knobY: 0,
      };
      let mouseXBound = false;
      let mouseYBound = false;

      if (!capturing && !rebindTarget) {
        for (const id of AXES) {
          for (const s of bindings.axes[id]) {
            const sign = sourceSign(s);
            if (s.type === 'mouseAxis') {
              if (s.axis === 'x') mouseXBound = true;
              else mouseYBound = true;
            } else if (s.type === 'key') {
              addAxis(sums, id, keysDown.has(s.code) ? sign : 0);
            } else if (s.type === 'mouseButton') {
              addAxis(sums, id, mouseButtons.has(s.button) ? sign : 0);
            } else if (s.type === 'gamepadButton') {
              addAxis(
                sums,
                id,
                pad ? axisDeadzone(buttonValue(pad.buttons, s.index), dz) * sign : 0,
              );
            } else if (s.type === 'mouseWheel') {
              const tick = wheelThisTick === 0 ? 0 : wheelThisTick < 0 ? 1 : -1;
              addAxis(sums, id, tick * sign);
            } else if (s.type === 'gamepadAxis') {
              let v = 0;
              if (pad) {
                if (s.index === 0) v = left.x;
                else if (s.index === 1) v = left.y;
                else if (s.index === 2) v = right.x;
                else v = right.y;
              }
              addAxis(sums, id, v * sign);
            }
          }
        }
      }

      f.lookX = clamp1(sums.lookX);
      f.lookY = clamp1(sums.lookY) * ySign;
      f.mouseDx = mouseXBound ? mdX : 0;
      f.mouseDy = mouseYBound ? mdY * ySign : 0;
      f.thrust = clamp1(sums.thrust);
      f.strafe = clamp1(sums.strafe);
      f.vertical = clamp1(sums.vertical);
      f.knobX = clamp1(sums.knobX);
      f.knobY = clamp1(sums.knobY) * ySign;

      for (let i = 0; i < ACTION_COUNT; i++) {
        const id = ACTIONS[i]!;
        let physical = false;
        if (!capturing && !rebindTarget) {
          for (const s of bindings.actions[id]) {
            if (sourcePhysical(s, pad)) {
              physical = true;
              break;
            }
          }
        }
        let down = physical;
        if (holdToToggle && isHoldAction(id)) {
          if (physical && prevPhysical[i] === 0) sticky[i] = sticky[i] ? 0 : 1;
          down = sticky[i] !== 0;
        } else {
          sticky[i] = 0;
        }
        heldTime[i] = down ? heldTime[i]! + dt : 0;
        f._down[i] = down ? 1 : 0;
        f._pressed[i] = down && prevDown[i] === 0 ? 1 : 0;
        f._released[i] = !down && prevDown[i] !== 0 ? 1 : 0;
        f._held[i] = heldTime[i]!;
        prevDown[i] = down ? 1 : 0;
        prevPhysical[i] = physical ? 1 : 0;
      }

      const drained = text.drain();
      f.capturingText = capturing;
      f.textValue = drained.value;
      f.textInserted = drained.inserted;
      f.textBackspace = drained.backspace;
      f.textEnter = drained.enter;
      f.textEscape = drained.escape;
      f.pointerLocked = pointer.locked;
      f.gamepadConnected = pad !== null;
      f.tick = tick;
      f.dt = dt;

      if (escapeFromUnlock) {
        keysDown.delete('Escape');
        escapeFromUnlock = false;
      }

      front = back;
      return f;
    },
    beginTextCapture(o) {
      pointer.exit(true);
      rebindTarget = null;
      rebindIgnore.clear();
      text.start(o);
    },
    endTextCapture() {
      return text.stop();
    },
    rebind(target, source, slot = 0) {
      bindings = applyRebind(bindings, target, source, slot);
      persist();
    },
    listenRebind(target, slot = 0) {
      rebindTarget = target;
      rebindSlot = slot;
      snapshotHeldSources();
    },
    cancelRebind() {
      rebindTarget = null;
      rebindIgnore.clear();
    },
    resetBindings() {
      bindings = defaultBindings();
      persist();
    },
    requestPointerLock() {
      if (text.active || rebindTarget) return;
      pointer.request();
    },
    exitPointerLock() {
      pointer.exit(true);
    },
    feedKey(code, down, key = '') {
      if (down) feedKeyDown(code, key || codeKey(code), false);
      else keysDown.delete(code);
    },
    feedMouseButton(button, down) {
      if (down) {
        maybeCaptureRebind({ type: 'mouseButton', button });
        mouseButtons.add(button);
      } else {
        mouseButtons.delete(button);
      }
    },
    feedMouseMove(dx, dy) {
      extraMouseDx += dx;
      extraMouseDy += dy;
    },
    feedWheel(deltaY) {
      if (rebindTarget) {
        maybeCaptureRebind({ type: 'mouseWheel', sign: deltaY < 0 ? -1 : 1 });
      }
      wheelY += deltaY;
    },
    setGamepads(pads) {
      gamepadOverride = pads;
    },
    setPointerLocked(locked, userUnlock = false) {
      if (pointer.setLocked) {
        pointer.setLocked(locked, userUnlock);
        return;
      }
      if (locked) pointer.request();
      else pointer.exit(!userUnlock);
    },
    dispose() {
      detach();
      pointer.detach();
      keysDown.clear();
      mouseButtons.clear();
    },
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isFormField(e.target)) return;
    const shouldBlock = text.active || rebindTarget !== null || boundCodes.has(e.code);
    if (shouldBlock && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    if (e.repeat && !text.active) return;
    if (rebindTarget && e.code === 'Escape') {
      e.preventDefault();
      rebindTarget = null;
      rebindIgnore.clear();
      return;
    }
    feedKeyDown(e.code, e.key, e.repeat);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keysDown.delete(e.code);
    rebindIgnore.delete(sourceId({ type: 'key', code: e.code }));
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (isFormField(e.target)) return;
    if (opts.target && e.target === opts.target && !text.active && !rebindTarget) {
      pointer.request();
    }
    service.feedMouseButton(e.button, true);
  };
  const onMouseUp = (e: MouseEvent): void => {
    service.feedMouseButton(e.button, false);
    rebindIgnore.delete(sourceId({ type: 'mouseButton', button: e.button }));
  };
  const onWheel = (e: WheelEvent): void => {
    if (opts.target && e.target instanceof Node && !opts.target.contains(e.target)) return;
    e.preventDefault();
    service.feedWheel(e.deltaY);
  };
  const onContextMenu = (e: Event): void => {
    if (opts.target && e.target === opts.target) e.preventDefault();
  };
  const onBlur = (): void => {
    keysDown.clear();
    mouseButtons.clear();
  };

  const detach = (): void => {
    if (!attached) return;
    attached = false;
    win?.removeEventListener('keydown', onKeyDown);
    win?.removeEventListener('keyup', onKeyUp);
    win?.removeEventListener('blur', onBlur);
    doc?.removeEventListener('mousedown', onMouseDown);
    doc?.removeEventListener('mouseup', onMouseUp);
    doc?.removeEventListener('wheel', onWheel);
    doc?.removeEventListener('contextmenu', onContextMenu);
    pointer.detach();
  };

  const shouldAttach = opts.attach ?? !!opts.target;
  if (shouldAttach && win && doc) {
    attached = true;
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', onBlur);
    doc.addEventListener('mousedown', onMouseDown);
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('contextmenu', onContextMenu);
    if (opts.target) pointer.attach(opts.target);
  } else if (opts.target) {
    pointer.attach(opts.target);
  }

  return service;
}

type AxisSums = Record<AxisId, number>;
