import { afterEach, describe, expect, it } from 'vitest';
import { DRAIN_FACTOR, LOCK_THRESHOLD, stepLockMeter } from '../../src/breach/PhaseLock';
import { createIceModel } from '../../src/breach/IceModel';
import {
  AUTO_HOLD_DECAY,
  BARK_GAP_S,
  ERASE_LICENSE_LABEL,
  ERASE_PROMPT,
  READ_COOLDOWN_S,
  READ_DELAY_S,
  barkOccupancy,
  canStartBark,
  createBarkGate,
  flatlineBark,
  formatRatioRead,
  iceEngagedBark,
  markBarkStarted,
} from '../../src/companion/barks';
import {
  asAskDixie,
  asDixieReadApi,
  createDixie,
  getAskDixieHook,
  getDixieReadApi,
  setAskDixieHook,
} from '../../src/companion/Dixie';
import { WHITE_ICE } from '../../src/content/ice/white';
import { createEventBus } from '../../src/core/events';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createSoftsRuntime } from '../../src/deck/softs/registry';

afterEach(() => {
  setAskDixieHook(null);
});

function make(opts?: {
  ratio?: readonly [number, number];
  save?: ReturnType<typeof createSaveStore>;
}) {
  const events = createEventBus();
  const ratio = opts?.ratio ?? ([3, 2] as const);
  const dixie = createDixie({
    events,
    save: opts?.save,
    aboard: true,
    iceRatio: () => ratio,
  });
  return { events, dixie };
}

describe('barks', () => {
  it('formats the ICE a:b the way Dixie speaks it', () => {
    expect(formatRatioRead(3, 2)).toBe("that's a three-two, kid");
    expect(formatRatioRead(2, 3)).toBe("that's a two-three, kid");
    expect(formatRatioRead(1, 1)).toBe("that's a one-one, kid");
  });

  it('blocks overlap and rate-limits non-critical barks to 12 s', () => {
    const gate = createBarkGate();
    expect(canStartBark(gate, false)).toBe(true);
    markBarkStarted(gate, 0.8, false);
    expect(canStartBark(gate, false)).toBe(false);
    expect(canStartBark(gate, true)).toBe(false);
    gate.t = 0.8;
    expect(canStartBark(gate, true)).toBe(true);
    expect(canStartBark(gate, false)).toBe(false);
    gate.t = BARK_GAP_S;
    expect(canStartBark(gate, false)).toBe(true);
  });

  it('labels the erase prompt as a design license', () => {
    expect(ERASE_PROMPT).toBe('ERASE CONSTRUCT? Y/N');
    expect(ERASE_LICENSE_LABEL).toBe('design license');
  });

  it("comments on the cowboy's flatline count", () => {
    expect(flatlineBark(1).critical).toBe(true);
    expect(flatlineBark(1).text).toMatch(/One/);
    expect(flatlineBark(3).text).toMatch(/Three/);
    expect(flatlineBark(4).text).toMatch(/dead man/);
  });
});

describe('DixieReadApi (M4.4 hook)', () => {
  it('is null when the companion is missing (softs no-op)', () => {
    expect(asDixieReadApi(null)).toBeNull();
    expect(asAskDixie(null)).toBeNull();
    expect(asAskDixie(undefined)).toBeNull();
    expect(getDixieReadApi()).toBeNull();
    expect(getAskDixieHook()).toBeNull();
  });

  it('read(ice) starts the 4 s H-read; read(null) is dixie-away', () => {
    const { dixie } = make();
    const ice = createIceModel(WHITE_ICE, { seed: 1 });
    ice.engage();
    const api = getDixieReadApi();
    expect(api).not.toBeNull();
    expect(api!.read(null)).toBe(false);
    expect(api!.read(ice)).toBe(true);
    expect(dixie.reading).toBeCloseTo(READ_DELAY_S, 5);
    dixie.update(READ_DELAY_S);
    expect(dixie.lastLine).toBe(
      formatRatioRead(ice.state.current.ratio[0], ice.state.current.ratio[1]),
    );
    dixie.dispose();
    expect(getDixieReadApi()).toBeNull();
  });

  it('SoftsWorld.dixie = asDixieReadApi(companion) forwards H; missing stays no-companion', () => {
    const { dixie } = make();
    const ice = createIceModel(WHITE_ICE, { seed: 1 });
    ice.engage();
    const runtime = createSoftsRuntime();
    expect(runtime.askDixie({ ice }).fail).toBe('no-companion');
    expect(runtime.askDixie({ ice, dixie: asDixieReadApi(dixie) }).ok).toBe(true);
    expect(dixie.reading).toBeCloseTo(READ_DELAY_S, 5);
    dixie.dispose();
  });
});

describe('Dixie companion', () => {
  it('does not overlap barks; critical lines queue until the current one ends', () => {
    const { events, dixie } = make();
    events.emit({ type: 'iceEngaged', iceId: 'x', layer: 0 });
    expect(dixie.speaking).toBe(true);
    const first = dixie.lastLine;
    events.emit({ type: 'gripStart', iceId: 'x' });
    expect(dixie.lastLine).toBe(first);
    dixie.update(barkOccupancy(first) + 0.01);
    expect(dixie.lastLine).not.toBe(first);
    expect(dixie.lastLineId).toBe('grip-start');
  });

  it('rate-limits non-critical barks to one per 12 s', () => {
    const { events, dixie } = make();
    events.emit({ type: 'iceEngaged', iceId: 'x', layer: 0 });
    const first = dixie.lastLine;
    dixie.update(barkOccupancy(first) + 0.05);
    events.emit({ type: 'iceRekey', iceId: 'x' });
    expect(dixie.lastLine).toBe(first);
    dixie.update(BARK_GAP_S);
    events.emit({ type: 'iceRekey', iceId: 'x' });
    expect(dixie.lastLineId).toBe('ice-rekey');
  });

  it('H-read reports the correct ratio after 4 s and cools down 20 s', () => {
    const { dixie } = make({ ratio: [3, 2] });
    expect(dixie.askRead()).toBe(true);
    expect(dixie.askRead()).toBe(false);
    dixie.update(READ_DELAY_S - 0.05);
    expect(dixie.lastLine).toBe('');
    dixie.update(0.05);
    expect(dixie.lastLine).toBe(formatRatioRead(3, 2));
    expect(dixie.readCooldown).toBeGreaterThan(READ_COOLDOWN_S - READ_DELAY_S - 0.1);
    expect(dixie.askRead()).toBe(false);
    dixie.update(READ_COOLDOWN_S);
    expect(dixie.askRead()).toBe(true);
  });

  it('auto-hold is 50% drain while flipped and 100% when toggled off', () => {
    const { events, dixie } = make();
    expect(dixie.lockDecayScale).toBe(1);
    events.emit({ type: 'simstimFlip', on: true });
    expect(dixie.flipped).toBe(true);
    expect(dixie.lockDecayScale).toBe(AUTO_HOLD_DECAY);
    dixie.setAutoHold(false);
    expect(dixie.lockDecayScale).toBe(1);
    dixie.setAutoHold(true);
    events.emit({ type: 'simstimFlip', on: false });
    expect(dixie.lockDecayScale).toBe(1);
  });

  it('comments on a flatline', () => {
    const { events, dixie } = make();
    events.emit({ type: 'flatline', scripted: false });
    expect(dixie.heardFlatlines).toBe(1);
    expect(dixie.lastLine).toBe(flatlineBark(1).text);
  });

  it('erase prompt writes the labelled Y/N choice onto the save', () => {
    const save = createSaveStore({ storage: createMemoryStorage() });
    save.load();
    const { dixie } = make({ save });
    dixie.startErase();
    expect(dixie.erasePrompt).toBe(true);
    expect(dixie.answerErase(true)).toBe(true);
    expect(save.data.campaign.dixieErased).toBe(true);
    expect(dixie.erased).toBe(true);
    expect(dixie.lastLineId).toBe('erase-yes');
  });
});

describe('lock-meter auto-hold (IceModel)', () => {
  it('drainScale 0.5 halves lock-meter decay without changing fill', () => {
    expect(stepLockMeter(0, LOCK_THRESHOLD, 0.5, 2.5, 0.5)).toBeCloseTo(0.2, 12);
    expect(stepLockMeter(0.5, 0.84, 1, 2, 1)).toBeCloseTo(0.25, 12);
    expect(stepLockMeter(0.5, 0.84, 1, 2, AUTO_HOLD_DECAY)).toBeCloseTo(0.375, 12);
  });

  it('toggling lockDecayScale is visible on the meter while draining', () => {
    const hold = createIceModel(WHITE_ICE, { seed: 1 });
    const full = createIceModel(WHITE_ICE, { seed: 1 });
    hold.engage();
    full.engage();
    hold.state.current.meter = 0.8;
    full.state.current.meter = 0.8;
    hold.state.lockDecayScale = AUTO_HOLD_DECAY;
    full.state.lockDecayScale = 1;
    const off = { R: 0.25, Phi: 0 };
    hold.step(1, off);
    full.step(1, off);
    expect(hold.state.current.m).toBeLessThan(LOCK_THRESHOLD);
    expect(full.state.current.meter).toBeLessThan(hold.state.current.meter);
    const expectedFull = 0.8 - DRAIN_FACTOR * (1 / 2) * 1;
    expect(full.state.current.meter).toBeCloseTo(expectedFull, 5);
    expect(hold.state.current.meter).toBeCloseTo(0.8 - DRAIN_FACTOR * AUTO_HOLD_DECAY * 0.5, 5);
  });
});

describe('bark catalog', () => {
  it('ice-engaged line is original Dixie voice', () => {
    expect(iceEngagedBark().text).toMatch(/kid/);
    expect(iceEngagedBark().critical).toBe(false);
  });
});
