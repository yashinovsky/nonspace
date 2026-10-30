import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../src/core/save';
import { createSettingsStore } from '../../src/core/settings';
import { fakeGamepad } from '../../src/input/gamepad';
import { BINDINGS_KEY, createInput } from '../../src/input/Input';
import { createFakePointerLock } from '../../src/input/pointerLock';
import { createTextCapture } from '../../src/input/textCapture';

const DT = 1 / 60;

function harness() {
  const storage = createMemoryStorage();
  const settings = createSettingsStore();
  const pointer = createFakePointerLock();
  const input = createInput({ settings, attach: false, storage, pointerLock: pointer });
  return { input, settings, storage, pointer };
}

describe('Input service', () => {
  it('maps WASD-style keys onto analog axes', () => {
    const { input } = harness();
    input.feedKey('KeyW', true);
    input.feedKey('KeyD', true);
    const f = input.sample(DT);
    expect(f.thrust).toBe(1);
    expect(f.strafe).toBe(1);
    expect(f.pressed('boost')).toBe(false);
  });

  it('reports pressed / released / held on digital actions', () => {
    const { input } = harness();
    input.feedKey('KeyF', true);
    const a = input.sample(DT);
    expect(a.down('scan')).toBe(true);
    expect(a.pressed('scan')).toBe(true);
    expect(a.held('scan')).toBeCloseTo(DT);
    const b = input.sample(DT);
    expect(b.pressed('scan')).toBe(false);
    expect(b.down('scan')).toBe(true);
    expect(b.held('scan')).toBeCloseTo(2 * DT);
    input.feedKey('KeyF', false);
    const c = input.sample(DT);
    expect(c.down('scan')).toBe(false);
    expect(c.released('scan')).toBe(true);
    expect(c.held('scan')).toBe(0);
  });

  it('applies mouse sensitivity and invert-Y from settings.input, not a copy', () => {
    const { input, settings, pointer } = harness();
    pointer.setLocked(true);
    pointer.move(10, 20);
    const base = input.sample(DT);
    expect(base.mouseDx).toBe(10);
    expect(base.mouseDy).toBe(-20);

    settings.update({ input: { mouseSensitivity: 2, invertY: true } });
    pointer.move(10, 20);
    const next = input.sample(DT);
    expect(next.mouseDx).toBe(20);
    expect(next.mouseDy).toBe(40);
    expect(settings.value.input.mouseSensitivity).toBe(2);
  });

  it('applies a live gamepad dead zone from settings.input', () => {
    const { input, settings } = harness();
    input.setGamepads([fakeGamepad({ axes: [0.1, 0, 0.5, 0] })]);
    const inside = input.sample(DT);
    expect(inside.strafe).toBe(0);
    expect(inside.lookX).toBeCloseTo((0.5 - 0.15) / 0.85);
    expect(inside.gamepadConnected).toBe(true);

    settings.update({ input: { gamepadDeadzone: 0.4 } });
    input.setGamepads([fakeGamepad({ axes: [0.1, 0, 0.5, 0] })]);
    const raised = input.sample(DT);
    expect(raised.lookX).toBeCloseTo((0.5 - 0.4) / 0.6);
  });

  it('maps the standard gamepad: A engage, RT thrust, d-pad softs', () => {
    const { input } = harness();
    const buttons: Array<boolean | number> = Array(16).fill(false);
    buttons[0] = true;
    buttons[7] = 1;
    buttons[12] = true;
    input.setGamepads([fakeGamepad({ buttons, axes: [0, 0, 0, 0] })]);
    const f = input.sample(DT);
    expect(f.down('engage')).toBe(true);
    expect(f.down('download')).toBe(true);
    expect(f.thrust).toBe(1);
    expect(f.down('soft1')).toBe(true);
    expect(f.pressed('engage')).toBe(true);
  });

  it('suspends actions while text-capture is active', () => {
    const { input } = harness();
    input.beginTextCapture();
    input.feedKey('KeyF', true, 'f');
    input.feedKey('KeyW', true, 'w');
    const f = input.sample(DT);
    expect(f.capturingText).toBe(true);
    expect(f.down('scan')).toBe(false);
    expect(f.thrust).toBe(0);
    expect(f.textValue).toBe('fw');
    expect(f.textInserted).toBe('fw');
    input.endTextCapture();
    const g = input.sample(DT);
    expect(g.capturingText).toBe(false);
    expect(g.textInserted).toBe('');
  });

  it('persists remaps to its own localStorage key', () => {
    const { input, storage } = harness();
    input.rebind('scan', { type: 'key', code: 'KeyG' }, 0);
    expect(JSON.parse(storage.items.get(BINDINGS_KEY)!).actions.scan[0].code).toBe('KeyG');

    const settings = createSettingsStore();
    const again = createInput({ settings, attach: false, storage });
    expect(again.bindings.actions.scan[0]).toEqual({ type: 'key', code: 'KeyG' });
    again.feedKey('KeyF', true);
    expect(again.sample(DT).down('scan')).toBe(false);
    again.feedKey('KeyG', true);
    expect(again.sample(DT).down('scan')).toBe(true);
  });

  it('listenRebind steals the next key and ignores Escape as cancel', () => {
    const { input } = harness();
    input.listenRebind('scan', 0);
    input.feedKey('Escape', true);
    input.sample(DT);
    expect(input.rebindTarget).toBeNull();
    expect(input.bindings.actions.scan[0]).toEqual(expect.objectContaining({ code: 'KeyF' }));

    input.listenRebind('scan', 0);
    input.feedKey('KeyK', true);
    input.sample(DT);
    expect(input.bindings.actions.scan[0]).toEqual({ type: 'key', code: 'KeyK' });
  });

  it('holdToToggle latches hold actions from a tap', () => {
    const { input, settings } = harness();
    settings.update({ holdToToggle: true });
    input.feedKey('ShiftLeft', true);
    expect(input.sample(DT).down('boost')).toBe(true);
    input.feedKey('ShiftLeft', false);
    expect(input.sample(DT).down('boost')).toBe(true);
    input.feedKey('ShiftLeft', true);
    expect(input.sample(DT).down('boost')).toBe(false);
  });

  it('treats a user pointer-lock unlock as a pause tap', () => {
    const { input, pointer } = harness();
    pointer.setLocked(true);
    pointer.setLocked(false, true);
    const f = input.sample(DT);
    expect(f.pressed('pause')).toBe(true);
    expect(input.sample(DT).pressed('pause')).toBe(false);
  });

  it('does not allocate a new frame object each sample', () => {
    const { input } = harness();
    const a = input.sample(DT);
    const b = input.sample(DT);
    const c = input.sample(DT);
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });
});

describe('textCapture', () => {
  it('edits a buffer and drains per-tick deltas', () => {
    const cap = createTextCapture();
    cap.start({ maxLength: 4 });
    cap.pushKey('a', false);
    cap.pushKey('b', false);
    cap.pushKey('c', false);
    cap.pushKey('d', false);
    cap.pushKey('e', false);
    const d = cap.drain();
    expect(d.value).toBe('abcd');
    expect(d.inserted).toBe('abcd');
    cap.pushKey('Backspace', false);
    cap.pushKey('Enter', false);
    const e = cap.drain();
    expect(e.value).toBe('abc');
    expect(e.backspace).toBe(1);
    expect(e.enter).toBe(true);
    expect(cap.stop()).toBe('abc');
    expect(cap.active).toBe(false);
  });
});
