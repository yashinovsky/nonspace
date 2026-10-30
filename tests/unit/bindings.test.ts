import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../src/core/save';
import {
  BINDINGS_KEY,
  defaultBindings,
  formatSource,
  gamepadOnlyPlayable,
  loadBindings,
  mouseOnlyPlayable,
  parseBindings,
  rebind,
  saveBindings,
  sourceId,
} from '../../src/input/bindings';

describe('bindings', () => {
  it('defaults cover every §3.9 action on keyboard and gamepad', () => {
    const set = defaultBindings();
    expect(set.actions.boost.some((s) => s.type === 'key' && s.code.startsWith('Shift'))).toBe(
      true,
    );
    expect(set.actions.boost.some((s) => s.type === 'gamepadButton' && s.index === 10)).toBe(true);
    expect(set.actions.scan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'key', code: 'KeyF' }),
        expect.objectContaining({ type: 'gamepadButton', index: 3 }),
      ]),
    );
    expect(set.actions.engage.some((s) => s.type === 'mouseButton' && s.button === 0)).toBe(true);
    expect(set.actions.pause.some((s) => s.type === 'key' && s.code === 'Escape')).toBe(true);
    expect(set.axes.thrust.some((s) => s.type === 'key' && s.code === 'KeyW' && s.sign === 1)).toBe(
      true,
    );
    expect(set.axes.strafe.some((s) => s.type === 'gamepadAxis' && s.index === 0)).toBe(true);
  });

  it('repairs missing or invalid actions instead of discarding the set', () => {
    const parsed = parseBindings({
      version: 1,
      actions: { scan: [{ type: 'key', code: 'KeyG' }], boost: 'nope' },
      axes: { thrust: [{ type: 'key', code: 'KeyI', sign: 1 }] },
    });
    expect(parsed.actions.scan).toEqual([{ type: 'key', code: 'KeyG' }]);
    expect(parsed.actions.boost).toEqual(defaultBindings().actions.boost);
    expect(parsed.axes.thrust).toEqual([{ type: 'key', code: 'KeyI', sign: 1 }]);
    expect(parsed.axes.lookX).toEqual(defaultBindings().axes.lookX);
  });

  it('steals a colliding source when rebinding', () => {
    const next = rebind(defaultBindings(), 'scan', { type: 'key', code: 'KeyW' }, 0);
    expect(next.actions.scan[0]).toEqual({ type: 'key', code: 'KeyW' });
    expect(next.axes.thrust.some((s) => s.type === 'key' && s.code === 'KeyW')).toBe(false);
  });

  it('round-trips through storage', () => {
    const storage = createMemoryStorage();
    const set = rebind(defaultBindings(), 'askDixie', { type: 'key', code: 'KeyQ' }, 0);
    expect(saveBindings(storage, set)).toBe(true);
    expect(storage.items.has(BINDINGS_KEY)).toBe(true);
    const loaded = loadBindings(storage);
    expect(loaded.actions.askDixie[0]).toEqual({ type: 'key', code: 'KeyQ' });
  });

  it('falls back to defaults on junk JSON', () => {
    const storage = createMemoryStorage();
    storage.setItem(BINDINGS_KEY, '{not json');
    expect(loadBindings(storage).actions.scan).toEqual(defaultBindings().actions.scan);
  });

  it('defaults are mouse-only and gamepad-only playable', () => {
    const set = defaultBindings();
    expect(mouseOnlyPlayable(set)).toBe(true);
    expect(gamepadOnlyPlayable(set)).toBe(true);
    expect(set.axes.thrust.some((s) => s.type === 'mouseWheel')).toBe(true);
    expect(formatSource({ type: 'mouseWheel' })).toBe('Wheel');
  });

  it('formats sources for the lab', () => {
    expect(formatSource({ type: 'key', code: 'KeyF' })).toBe('F');
    expect(formatSource({ type: 'mouseButton', button: 0 })).toBe('LMB');
    expect(formatSource({ type: 'gamepadButton', index: 0 })).toBe('A');
    expect(sourceId({ type: 'key', code: 'KeyF', sign: -1 })).toBe('key:KeyF');
  });
});
