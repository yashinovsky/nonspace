import { describe, expect, it } from 'vitest';
import { createModeStack, type Mode, type ModeId } from '../../src/app/ModeStack';
import { createSimstimMode } from '../../src/app/modes/Simstim';
import { labSimstimTimeline, LAB_GATE } from '../../src/content/simstim/labTimeline';
import { createEventBus } from '../../src/core/events';
import { SIM_DT } from '../../src/core/loop';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createSettingsStore } from '../../src/core/settings';
import { createInput } from '../../src/input/Input';
import {
  bayer4,
  ditherQuantize,
  nearestPaletteIndex,
  PALETTE_SIZE,
  SIMSTIM_PALETTE_HEX,
} from '../../src/render/simstim/palette';
import { chipClockAt, formatClock, parseClock } from '../../src/simstim/clock';
import { idleFlipState, PEEK_HOLD_S, stepFlip } from '../../src/simstim/flip';
import { createGates } from '../../src/simstim/Gates';
import { createMollyTimeline, sampleCameraPath } from '../../src/simstim/MollyTimeline';
import { createPain, PAIN_ECHO_NEURAL } from '../../src/simstim/Pain';
import { createSimstimFeed } from '../../src/simstim/SimstimFeed';
import { sampleTimeline } from '../../src/testing/fixtures';
import { recordEvents } from '../../src/testing/mocks';

const DT = SIM_DT;

function services() {
  const events = createEventBus();
  const settings = createSettingsStore();
  const save = createSaveStore({ storage: createMemoryStorage() });
  const input = createInput({ settings, attach: false, storage: createMemoryStorage() });
  return { events, settings, save, input };
}

describe('chip clock', () => {
  it('parses, formats and offsets from clockStart', () => {
    expect(parseClock('02:14:07')).toBe(2 * 3600 + 14 * 60 + 7);
    expect(formatClock(parseClock('02:14:07') + 5)).toBe('02:14:12');
    expect(chipClockAt('02:14:07', 53)).toBe('02:15:00');
  });
});

describe('Bayer dither quantize', () => {
  it('has 16 unique palette entries and snaps primaries', () => {
    expect(PALETTE_SIZE).toBe(16);
    expect(new Set(SIMSTIM_PALETTE_HEX).size).toBe(16);
    expect(nearestPaletteIndex(0, 0, 0)).toBe(0);
    const red = nearestPaletteIndex(0.75, 0.1, 0.1);
    expect(SIMSTIM_PALETTE_HEX[red]).toBe(0xc03028);
  });

  it('Bayer 4×4 is a permutation of 0..15 and dither changes the snap', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) seen.add(Math.floor(bayer4(x, y) * 16));
    }
    expect(seen.size).toBe(16);
    const a = ditherQuantize(0.55, 0.52, 0.5, 0, 0, 0.35);
    const b = ditherQuantize(0.55, 0.52, 0.5, 1, 1, 0.35);
    expect(a).not.toEqual(b);
  });
});

describe('flip / peek / lag', () => {
  it('short press toggles on and stays', () => {
    let s = idleFlipState();
    s = stepFlip(s, { pressed: true, released: false, held: DT }, DT);
    expect(s.flipped).toBe(true);
    s = stepFlip(s, { pressed: false, released: true, held: 0 }, DT);
    expect(s.flipped).toBe(true);
    expect(s.peeking).toBe(false);
  });

  it('hold peeks and release returns', () => {
    let s = idleFlipState();
    s = stepFlip(s, { pressed: true, released: false, held: DT }, DT);
    let held = DT;
    while (held < PEEK_HOLD_S + DT) {
      held += DT;
      s = stepFlip(s, { pressed: false, released: false, held }, DT);
    }
    expect(s.flipped).toBe(true);
    expect(s.peeking).toBe(true);
    s = stepFlip(s, { pressed: false, released: true, held: 0 }, DT);
    expect(s.flipped).toBe(false);
  });

  it('tap while flipped toggles off', () => {
    let s = idleFlipState();
    s = stepFlip(s, { pressed: true, released: false, held: DT }, DT);
    s = stepFlip(s, { pressed: false, released: true, held: 0 }, DT);
    s = stepFlip(s, { pressed: true, released: false, held: DT }, DT);
    s = stepFlip(s, { pressed: false, released: true, held: 0 }, DT);
    expect(s.flipped).toBe(false);
  });
});

describe('MollyTimeline', () => {
  it('plays in meat time and freezes pose while waiting', () => {
    const tl = createMollyTimeline();
    tl.load(sampleTimeline());
    tl.update(DT, 0, null);
    for (let i = 0; i < 60; i++) tl.update(DT, (i + 1) * DT, null);
    const moving = tl.sample();
    expect(moving.playbackTime).toBeCloseTo(1, 1);
    expect(moving.camera.pos.z).toBeLessThan(0);

    const hold = 1;
    tl.update(DT, 2, hold);
    const frozen = tl.sample();
    expect(frozen.waiting).toBe(true);
    expect(frozen.playbackTime).toBe(hold);
    const cam = { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, bob: 0 };
    sampleCameraPath(sampleTimeline().cameraPath, hold, cam);
    expect(frozen.camera.pos.z).toBeCloseTo(cam.pos.z, 3);
  });

  it('fires spoken lines once as playback crosses t', () => {
    const tl = createMollyTimeline();
    tl.load(sampleTimeline());
    tl.update(0.5, 0.5, null);
    expect(tl.firedLines).toHaveLength(0);
    tl.update(0.6, 1.1, null);
    expect(tl.firedLines.map((l) => l.text)).toEqual(['Going in.']);
    tl.update(0.5, 1.6, null);
    expect(tl.firedLines).toHaveLength(0);
  });
});

describe('Gates', () => {
  it('opens, hits, early, late with wait exposure, then missed', () => {
    const events = createEventBus();
    const rec = recordEvents(events);
    const gates = createGates({
      events,
      gates: [
        {
          id: 'door-1',
          iceNode: 'ice-a',
          tMeat: 8,
          early: 3,
          late: 2,
          onEarly: [],
          onLate: [],
        },
      ],
      branches: [{ atGate: 'door-1', onLate: { holdUntilOpen: true, exposurePerSec: 0.04 } }],
    });

    gates.update(4.9, DT);
    events.flush();
    expect(gates.get('door-1')?.state).toBe('idle');

    gates.update(5.0, DT);
    events.flush();
    expect(gates.get('door-1')?.state).toBe('open');
    expect(rec.ofType('gateWindow').map((e) => e.state)).toEqual(['open']);

    gates.crack('ice-a');
    gates.update(6.0, DT);
    events.flush();
    expect(gates.get('door-1')?.state).toBe('hit');
    expect(rec.last('gateWindow')?.state).toBe('hit');

    gates.reset();
    rec.clear();
    gates.crack('ice-a');
    gates.update(1, DT);
    events.flush();
    expect(gates.get('door-1')?.state).toBe('early');

    gates.reset();
    rec.clear();
    gates.update(5, DT);
    gates.update(10.1, DT);
    events.flush();
    expect(gates.get('door-1')?.state).toBe('late');
    expect(gates.waiting).toBe(true);
    expect(gates.waitPlayback).toBe(8);

    for (let i = 0; i < 60; i++) gates.update(11 + i * DT, DT);
    expect(gates.get('door-1')!.exposure).toBeGreaterThan(0.03);

    gates.reset();
    rec.clear();
    const g2 = createGates({
      events,
      gates: [
        {
          id: 'door-1',
          iceNode: 'ice-a',
          tMeat: 8,
          early: 3,
          late: 2,
          onEarly: [],
          onLate: [],
        },
      ],
      branches: [{ atGate: 'door-1', onLate: { holdUntilOpen: false, exposurePerSec: 0.04 } }],
    });
    g2.update(11, DT);
    events.flush();
    expect(g2.get('door-1')?.state).toBe('missed');
  });
});

describe('Pain', () => {
  it('overlays and echoes into neural load on flip-back', () => {
    const events = createEventBus();
    const rec = recordEvents(events);
    const pain = createPain({ events });
    pain.hurt(0.8);
    events.flush();
    expect(pain.amount).toBeCloseTo(0.8);
    expect(pain.overlay.vignette).toBeCloseTo(0.8);
    expect(pain.overlay.frameHold).toBeGreaterThan(0);
    expect(rec.last('mollyPain')?.amount).toBe(0.8);

    pain.flipBack();
    events.flush();
    expect(pain.neural).toBeCloseTo(0.8 * PAIN_ECHO_NEURAL);
    expect(rec.last('neuralChanged')?.value).toBeCloseTo(0.8 * PAIN_ECHO_NEURAL);
  });
});

describe('SimstimFeed AC', () => {
  it('advances meat time whether or not flipped', () => {
    const { events } = services();
    const feed = createSimstimFeed({ events });
    feed.load(labSimstimTimeline(), [LAB_GATE]);
    for (let i = 0; i < 120; i++) feed.update(DT);
    const unflipped = feed.meatTime;
    expect(unflipped).toBeCloseTo(2, 1);
    feed.setFlipped(true);
    events.flush();
    expect(feed.flipped).toBe(true);
    expect(events.pendingCount()).toBe(0);
    for (let i = 0; i < 60; i++) feed.update(DT);
    expect(feed.meatTime).toBeCloseTo(3, 1);
    expect(feed.debug.clock.startsWith('02:14')).toBe(true);
  });

  it('posts simstimFlip and starts 0.4 s lag on flip-back', () => {
    const { events } = services();
    const rec = recordEvents(events);
    const feed = createSimstimFeed({ events });
    feed.load(sampleTimeline());
    feed.setFlipped(true);
    events.flush();
    expect(rec.last('simstimFlip')?.on).toBe(true);
    feed.setFlipped(false);
    events.flush();
    expect(rec.last('simstimFlip')?.on).toBe(false);
    expect(feed.lag).toBeCloseTo(0.4);
    expect(feed.controlScale).toBeLessThan(1);
    for (let i = 0; i < 30; i++) feed.update(DT);
    expect(feed.lag).toBeCloseTo(0, 1);
    expect(feed.controlScale).toBe(1);
  });

  it('keeps the matrix simulating (re-key) while flipped', () => {
    const { events, settings, save, input } = services();
    const rec = recordEvents(events);
    const feed = createSimstimFeed({ events });
    feed.load(labSimstimTimeline(), [LAB_GATE]);
    const modes = createModeStack({ events, settings, save, input, simstim: feed });
    const simstim = createSimstimMode(feed);
    let rekeys = 0;
    const matrix: Mode = {
      id: 'matrix' as ModeId,
      simulatesWhenCovered: true,
      enter() {},
      exit() {},
      update() {
        rekeys += 1;
        events.post({ type: 'iceRekey', iceId: LAB_GATE.iceNode });
      },
      render() {},
      handleInput() {},
    };
    modes.push(matrix);
    feed.setFlipped(true);
    modes.push(simstim);
    expect(modes.ids()).toEqual(['matrix', 'simstim']);
    expect(modes.top?.id).toBe('simstim');
    for (let i = 0; i < 12; i++) {
      modes.update(DT);
      events.flush();
      feed.update(DT);
    }
    expect(rekeys).toBe(12);
    expect(rec.ofType('iceRekey').length).toBe(12);
    expect(feed.debug.rekeysWhileFlipped).toBe(12);
  });

  it('fires gate early / hit / late and accrues wait exposure', () => {
    const { events } = services();
    const rec = recordEvents(events);
    const feed = createSimstimFeed({ events });
    feed.load(labSimstimTimeline(), [LAB_GATE]);

    feed.crack(LAB_GATE.iceNode);
    feed.update(1);
    events.flush();
    expect(feed.gates.get('door-1')?.state).toBe('early');
    expect(rec.ofType('gateWindow').some((e) => e.state === 'early')).toBe(true);

    feed.reset();
    rec.clear();
    feed.load(labSimstimTimeline(), [LAB_GATE]);
    for (let i = 0; i < Math.round(6 / DT); i++) feed.update(DT);
    events.flush();
    expect(feed.gates.get('door-1')?.state).toBe('open');
    feed.crack(LAB_GATE.iceNode);
    feed.update(DT);
    events.flush();
    expect(feed.gates.get('door-1')?.state).toBe('hit');

    feed.reset();
    rec.clear();
    feed.load(labSimstimTimeline(), [LAB_GATE]);
    for (let i = 0; i < Math.round(11 / DT); i++) feed.update(DT);
    events.flush();
    expect(feed.gates.get('door-1')?.state).toBe('late');
    expect(feed.timeline.waiting).toBe(true);
    const pose = feed.sample().camera.pos.z;
    feed.update(0.5);
    expect(feed.sample().camera.pos.z).toBeCloseTo(pose, 5);
    expect(feed.gates.get('door-1')!.exposure).toBeGreaterThan(0.01);
  });
});
