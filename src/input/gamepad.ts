/**
 * Standard Gamepad mapping (W3C Gamepad API). Sticks use a radial dead zone
 * from `settings.input.gamepadDeadzone`; triggers use the same threshold on
 * their analog value.
 */

export interface GamepadButtonSnap {
  pressed: boolean;
  value: number;
}

export interface GamepadSnapshot {
  id?: string;
  index?: number;
  mapping: string;
  connected: boolean;
  axes: ArrayLike<number>;
  buttons: ArrayLike<GamepadButtonSnap | number>;
}

export function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Radial stick dead zone, then rescale the remainder to [-1, 1]. */
export function radialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (!(m > 0) || m <= dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz);
  const k = scale / m;
  return { x: clamp1(x * k), y: clamp1(y * k) };
}

/** 1D dead zone (triggers, or a lone axis). */
export function axisDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

export function buttonValue(buttons: ArrayLike<GamepadButtonSnap | number>, index: number): number {
  const b = buttons[index];
  if (b == null) return 0;
  if (typeof b === 'number') return b;
  return b.value;
}

export function buttonPressed(
  buttons: ArrayLike<GamepadButtonSnap | number>,
  index: number,
): boolean {
  const b = buttons[index];
  if (b == null) return false;
  if (typeof b === 'number') return b > 0.5;
  return b.pressed || b.value > 0.5;
}

export function axisValue(axes: ArrayLike<number>, index: number): number {
  const v = axes[index];
  return typeof v === 'number' && Number.isFinite(v) ? clamp1(v) : 0;
}

export function isStandardPad(pad: GamepadSnapshot | null | undefined): boolean {
  if (!pad || pad.connected === false) return false;
  return pad.mapping === 'standard' || pad.mapping === '';
}

/** First connected standard-mapped pad, or null. */
export function pickGamepad(
  pads: ArrayLike<GamepadSnapshot | Gamepad | null>,
): GamepadSnapshot | null {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p && isStandardPad(p as GamepadSnapshot)) return p as GamepadSnapshot;
  }
  return null;
}

export function snapshotFromNative(pad: Gamepad): GamepadSnapshot {
  return {
    id: pad.id,
    index: pad.index,
    mapping: pad.mapping,
    connected: pad.connected,
    axes: pad.axes,
    buttons: pad.buttons,
  };
}

/** Build a snapshot for tests. Unspecified buttons/axes are zero. */
export function fakeGamepad(partial: {
  axes?: number[];
  buttons?: Array<boolean | number | GamepadButtonSnap>;
  mapping?: string;
  connected?: boolean;
}): GamepadSnapshot {
  const axes = [0, 0, 0, 0];
  if (partial.axes) {
    for (let i = 0; i < partial.axes.length && i < 4; i++) axes[i] = partial.axes[i]!;
  }
  const buttons: GamepadButtonSnap[] = [];
  for (let i = 0; i < 17; i++) buttons.push({ pressed: false, value: 0 });
  if (partial.buttons) {
    for (let i = 0; i < partial.buttons.length; i++) {
      const b = partial.buttons[i]!;
      if (typeof b === 'boolean') buttons[i] = { pressed: b, value: b ? 1 : 0 };
      else if (typeof b === 'number') buttons[i] = { pressed: b > 0.5, value: b };
      else buttons[i] = b;
    }
  }
  return {
    mapping: partial.mapping ?? 'standard',
    connected: partial.connected ?? true,
    axes,
    buttons,
  };
}
