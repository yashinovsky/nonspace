import { z } from 'zod';
import type { StorageLike } from '../core/save';

/**
 * Action names and default bindings (plan §3.9). Modes consume these, never
 * raw keys. Sensitivity / invert-Y / gamepad dead zone live in
 * `settings.input` (plan §9.9) and are not stored here.
 *
 * Bindings persist under `nonspace.bindings` (their own localStorage key, not
 * the save blob). A remap that collides with another action steals the source.
 */

export const BINDINGS_KEY = 'nonspace.bindings';
export const BINDINGS_VERSION = 1;

/** Digital actions. Hold-style ones honour `settings.holdToToggle` (§8.10). */
export const ACTIONS = [
  'boost',
  'scan',
  'engage',
  'fineAdjust',
  'soft1',
  'soft2',
  'soft3',
  'soft4',
  'askDixie',
  'download',
  'simstim',
  'deck',
  'jackOut',
  'pause',
] as const;
export type ActionId = (typeof ACTIONS)[number];

export const HOLD_ACTIONS = ['boost', 'fineAdjust', 'download', 'jackOut'] as const;
export type HoldActionId = (typeof HOLD_ACTIONS)[number];

export const HOLD_ACTION_SET: ReadonlySet<string> = new Set(HOLD_ACTIONS);

export const AXES = ['lookX', 'lookY', 'thrust', 'strafe', 'vertical', 'knobX', 'knobY'] as const;
export type AxisId = (typeof AXES)[number];

export type BindTarget = ActionId | AxisId;

export function isActionId(value: string): value is ActionId {
  return (ACTIONS as readonly string[]).includes(value);
}

export function isAxisId(value: string): value is AxisId {
  return (AXES as readonly string[]).includes(value);
}

export function isHoldAction(value: string): value is HoldActionId {
  return HOLD_ACTION_SET.has(value);
}

const signSchema = z.union([z.literal(1), z.literal(-1)]).optional();

export const bindingSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key'), code: z.string().min(1), sign: signSchema }),
  z.object({ type: z.literal('mouseButton'), button: z.number().int().min(0).max(4) }),
  z.object({
    type: z.literal('mouseAxis'),
    axis: z.enum(['x', 'y']),
    sign: signSchema,
  }),
  z.object({
    type: z.literal('mouseWheel'),
    sign: signSchema,
  }),
  z.object({
    type: z.literal('gamepadButton'),
    index: z.number().int().min(0).max(16),
    sign: signSchema,
  }),
  z.object({
    type: z.literal('gamepadAxis'),
    index: z.number().int().min(0).max(3),
    sign: signSchema,
  }),
]);
export type BindingSource = z.infer<typeof bindingSourceSchema>;

const sourcesSchema = z.array(bindingSourceSchema).catch(() => []);

export type ActionMap = Record<ActionId, BindingSource[]>;
export type AxisMap = Record<AxisId, BindingSource[]>;

export interface BindingSet {
  version: number;
  actions: ActionMap;
  axes: AxisMap;
}

function src(s: BindingSource): BindingSource {
  return s;
}

/** Standard Gamepad mapping indices (W3C). */
export const Pad = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
  LeftX: 0,
  LeftY: 1,
  RightX: 2,
  RightY: 3,
} as const;

/**
 * Default bindings from plan §3.9.
 *
 * On the standard gamepad mapping, Menu and Start are the same physical
 * button (index 9). Pause is a tap of that button; jack-out is a 1 s hold.
 * Keyboard keeps them separate (Esc vs J). Shift is both boost and fine
 * adjust; A / left-click is both engage (press) and download (hold). Modes
 * pick the reading that matches their context.
 */
export function defaultBindings(): BindingSet {
  const actions: ActionMap = {
    boost: [
      src({ type: 'key', code: 'ShiftLeft' }),
      src({ type: 'key', code: 'ShiftRight' }),
      src({ type: 'mouseButton', button: 2 }),
      src({ type: 'gamepadButton', index: Pad.L3 }),
    ],
    scan: [
      src({ type: 'key', code: 'KeyF' }),
      src({ type: 'mouseButton', button: 1 }),
      src({ type: 'gamepadButton', index: Pad.Y }),
    ],
    engage: [src({ type: 'mouseButton', button: 0 }), src({ type: 'gamepadButton', index: Pad.A })],
    fineAdjust: [
      src({ type: 'key', code: 'ShiftLeft' }),
      src({ type: 'key', code: 'ShiftRight' }),
      src({ type: 'gamepadButton', index: Pad.LB }),
    ],
    soft1: [
      src({ type: 'key', code: 'Digit1' }),
      src({ type: 'gamepadButton', index: Pad.DpadUp }),
    ],
    soft2: [
      src({ type: 'key', code: 'Digit2' }),
      src({ type: 'gamepadButton', index: Pad.DpadRight }),
    ],
    soft3: [
      src({ type: 'key', code: 'Digit3' }),
      src({ type: 'gamepadButton', index: Pad.DpadDown }),
    ],
    soft4: [
      src({ type: 'key', code: 'Digit4' }),
      src({ type: 'gamepadButton', index: Pad.DpadLeft }),
    ],
    askDixie: [src({ type: 'key', code: 'KeyH' }), src({ type: 'gamepadButton', index: Pad.X })],
    download: [src({ type: 'key', code: 'KeyE' }), src({ type: 'gamepadButton', index: Pad.A })],
    simstim: [src({ type: 'key', code: 'KeyT' }), src({ type: 'gamepadButton', index: Pad.B })],
    deck: [
      src({ type: 'key', code: 'Tab' }),
      src({ type: 'mouseButton', button: 3 }),
      src({ type: 'gamepadButton', index: Pad.Back }),
    ],
    jackOut: [
      src({ type: 'key', code: 'KeyJ' }),
      src({ type: 'mouseButton', button: 4 }),
      src({ type: 'gamepadButton', index: Pad.Start }),
    ],
    pause: [src({ type: 'key', code: 'Escape' }), src({ type: 'gamepadButton', index: Pad.Start })],
  };
  const axes: AxisMap = {
    lookX: [src({ type: 'mouseAxis', axis: 'x' }), src({ type: 'gamepadAxis', index: Pad.RightX })],
    lookY: [src({ type: 'mouseAxis', axis: 'y' }), src({ type: 'gamepadAxis', index: Pad.RightY })],
    thrust: [
      src({ type: 'key', code: 'KeyW', sign: 1 }),
      src({ type: 'key', code: 'KeyS', sign: -1 }),
      src({ type: 'mouseWheel' }),
      src({ type: 'gamepadButton', index: Pad.RT, sign: 1 }),
      src({ type: 'gamepadButton', index: Pad.LT, sign: -1 }),
    ],
    strafe: [
      src({ type: 'key', code: 'KeyD', sign: 1 }),
      src({ type: 'key', code: 'KeyA', sign: -1 }),
      src({ type: 'gamepadAxis', index: Pad.LeftX }),
    ],
    vertical: [
      src({ type: 'key', code: 'Space', sign: 1 }),
      src({ type: 'key', code: 'ControlLeft', sign: -1 }),
      src({ type: 'key', code: 'ControlRight', sign: -1 }),
      src({ type: 'gamepadButton', index: Pad.RB, sign: 1 }),
      src({ type: 'gamepadButton', index: Pad.LB, sign: -1 }),
    ],
    knobX: [src({ type: 'mouseAxis', axis: 'x' }), src({ type: 'gamepadAxis', index: Pad.LeftX })],
    knobY: [src({ type: 'mouseAxis', axis: 'y' }), src({ type: 'gamepadAxis', index: Pad.RightY })],
  };
  return { version: BINDINGS_VERSION, actions, axes };
}

export function cloneBindings(set: BindingSet): BindingSet {
  return {
    version: set.version,
    actions: Object.fromEntries(
      ACTIONS.map((id) => [id, set.actions[id].map((s) => ({ ...s }))]),
    ) as ActionMap,
    axes: Object.fromEntries(
      AXES.map((id) => [id, set.axes[id].map((s) => ({ ...s }))]),
    ) as AxisMap,
  };
}

export function sourceSign(source: BindingSource): 1 | -1 {
  return source.type === 'mouseButton' ? 1 : (source.sign ?? 1);
}

/** Stable identity for collision checks (sign is ignored: one physical control, one owner). */
export function sourceId(source: BindingSource): string {
  switch (source.type) {
    case 'key':
      return `key:${source.code}`;
    case 'mouseButton':
      return `mouseButton:${source.button}`;
    case 'mouseAxis':
      return `mouseAxis:${source.axis}`;
    case 'mouseWheel':
      return 'mouseWheel';
    case 'gamepadButton':
      return `gamepadButton:${source.index}`;
    case 'gamepadAxis':
      return `gamepadAxis:${source.index}`;
  }
}

export function sourcesEqual(a: BindingSource, b: BindingSource): boolean {
  return sourceId(a) === sourceId(b);
}

export function formatSource(source: BindingSource): string {
  switch (source.type) {
    case 'key': {
      const sign = source.sign === -1 ? '-' : source.sign === 1 ? '+' : '';
      return `${sign}${shortCode(source.code)}`;
    }
    case 'mouseButton':
      return ['LMB', 'MMB', 'RMB', 'MB4', 'MB5'][source.button] ?? `MB${source.button}`;
    case 'mouseAxis':
      return `Mouse ${source.axis.toUpperCase()}`;
    case 'mouseWheel':
      return source.sign === 1 ? 'Wheel+' : 'Wheel';
    case 'gamepadButton':
      return GAMEPAD_BUTTON_NAMES[source.index] ?? `Btn ${source.index}`;
    case 'gamepadAxis':
      return GAMEPAD_AXIS_NAMES[source.index] ?? `Axis ${source.index}`;
  }
}

function shortCode(code: string): string {
  const named: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Escape: 'Esc',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  return code;
}

const GAMEPAD_BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'L3',
  'R3',
  'D-up',
  'D-down',
  'D-left',
  'D-right',
];
const GAMEPAD_AXIS_NAMES = ['LS X', 'LS Y', 'RS X', 'RS Y'];

function fillActions(raw: unknown): ActionMap {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as ActionMap;
  for (const id of ACTIONS) {
    const parsed = sourcesSchema.parse(obj[id]);
    out[id] = parsed.length > 0 ? parsed : defaultBindings().actions[id];
  }
  return out;
}

function fillAxes(raw: unknown): AxisMap {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as AxisMap;
  const defaults = defaultBindings().axes;
  for (const id of AXES) {
    const parsed = sourcesSchema.parse(obj[id]);
    out[id] = parsed.length > 0 ? parsed : defaults[id];
  }
  return out;
}

/** Validate untrusted storage into a complete BindingSet. Missing actions fall back to defaults. */
export function parseBindings(raw: unknown): BindingSet {
  if (!raw || typeof raw !== 'object') return defaultBindings();
  const rec = raw as Record<string, unknown>;
  return {
    version: BINDINGS_VERSION,
    actions: fillActions(rec.actions),
    axes: fillAxes(rec.axes),
  };
}

/**
 * Replace `slot` on `target` with `source`, stealing that physical control
 * from every other action/axis. Returns a new set.
 */
export function rebind(
  set: BindingSet,
  target: BindTarget,
  source: BindingSource,
  slot = 0,
): BindingSet {
  const next = cloneBindings(set);
  const steal = sourceId(source);
  const strip = (list: BindingSource[]): BindingSource[] =>
    list.filter((s) => sourceId(s) !== steal);

  for (const id of ACTIONS) next.actions[id] = strip(next.actions[id]);
  for (const id of AXES) next.axes[id] = strip(next.axes[id]);

  if (isActionId(target)) {
    const list = next.actions[target];
    if (slot >= 0 && slot < list.length) list[slot] = { ...source };
    else list.push({ ...source });
  } else {
    const list = next.axes[target];
    if (slot >= 0 && slot < list.length) list[slot] = { ...source };
    else list.push({ ...source });
  }
  return next;
}

export function loadBindings(storage: StorageLike | null, key = BINDINGS_KEY): BindingSet {
  if (!storage) return defaultBindings();
  try {
    const json = storage.getItem(key);
    if (!json) return defaultBindings();
    return parseBindings(JSON.parse(json));
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(
  storage: StorageLike | null,
  set: BindingSet,
  key = BINDINGS_KEY,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: BINDINGS_VERSION, actions: set.actions, axes: set.axes }),
    );
    return true;
  } catch {
    return false;
  }
}

function hasType(list: BindingSource[], type: BindingSource['type']): boolean {
  return list.some((s) => s.type === type);
}

/** True when look, thrust, and engage can be driven without a keyboard or gamepad. */
export function mouseOnlyPlayable(set: BindingSet): boolean {
  const look = hasType(set.axes.lookX, 'mouseAxis') || hasType(set.axes.knobX, 'mouseAxis');
  const thrust = hasType(set.axes.thrust, 'mouseWheel') || hasType(set.axes.thrust, 'mouseButton');
  const engage = hasType(set.actions.engage, 'mouseButton');
  return look && thrust && engage;
}

/** True when look, thrust, and engage can be driven without a keyboard or mouse. */
export function gamepadOnlyPlayable(set: BindingSet): boolean {
  const look = hasType(set.axes.lookX, 'gamepadAxis');
  const thrust =
    hasType(set.axes.thrust, 'gamepadButton') || hasType(set.axes.thrust, 'gamepadAxis');
  const engage = hasType(set.actions.engage, 'gamepadButton');
  return look && thrust && engage;
}
