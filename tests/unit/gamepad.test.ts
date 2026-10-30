import { describe, expect, it } from 'vitest';
import {
  axisDeadzone,
  buttonPressed,
  fakeGamepad,
  pickGamepad,
  radialDeadzone,
} from '../../src/input/gamepad';

describe('gamepad helpers', () => {
  it('radial dead zone zeros inside the disk and rescales outside', () => {
    expect(radialDeadzone(0.05, 0, 0.15)).toEqual({ x: 0, y: 0 });
    const out = radialDeadzone(1, 0, 0.15);
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBe(0);
    const diag = radialDeadzone(0.5, 0, 0.15);
    expect(diag.x).toBeCloseTo((0.5 - 0.15) / 0.85);
  });

  it('1D dead zone matches the trigger path', () => {
    expect(axisDeadzone(0.1, 0.15)).toBe(0);
    expect(axisDeadzone(-1, 0.15)).toBeCloseTo(-1);
    expect(axisDeadzone(0.575, 0.15)).toBeCloseTo(0.5);
  });

  it('picks the first connected standard pad', () => {
    const a = fakeGamepad({ connected: false });
    const b = fakeGamepad({ mapping: 'xr-standard' });
    const c = fakeGamepad({ buttons: [true] });
    expect(pickGamepad([a, b, c])).toBe(c);
    expect(pickGamepad([null, a])).toBeNull();
  });

  it('reads analog and digital buttons', () => {
    const pad = fakeGamepad({ buttons: [true, 0.2, { pressed: false, value: 0.8 }] });
    expect(buttonPressed(pad.buttons, 0)).toBe(true);
    expect(buttonPressed(pad.buttons, 1)).toBe(false);
    expect(buttonPressed(pad.buttons, 2)).toBe(true);
  });
});
