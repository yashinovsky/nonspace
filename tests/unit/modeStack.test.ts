import { describe, expect, it } from 'vitest';
import { createModeStack, type Mode, type ModeContext, type ModeId } from '../../src/app/ModeStack';
import { createEventBus } from '../../src/core/events';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createSettingsStore } from '../../src/core/settings';
import { recordEvents } from '../../src/testing/mocks';

interface TestMode extends Mode {
  ctx: ModeContext | null;
  updates: number;
  renders: number;
  inputs: unknown[];
}

function setup() {
  const events = createEventBus();
  const rec = recordEvents(events);
  const log: string[] = [];
  const modes = createModeStack({
    events,
    settings: createSettingsStore(),
    save: createSaveStore({ storage: createMemoryStorage() }),
  });

  const mode = (id: ModeId, simulatesWhenCovered = false, hooks: Partial<Mode> = {}): TestMode => {
    const m: TestMode = {
      id,
      simulatesWhenCovered,
      ctx: null,
      updates: 0,
      renders: 0,
      inputs: [],
      enter(ctx) {
        m.ctx = ctx;
        log.push(`enter:${id}`);
        hooks.enter?.(ctx);
      },
      exit() {
        log.push(`exit:${id}`);
        hooks.exit?.();
      },
      update(dt) {
        m.updates++;
        log.push(`update:${id}`);
        hooks.update?.(dt);
      },
      render(alpha) {
        m.renders++;
        log.push(`render:${id}`);
        hooks.render?.(alpha);
      },
      handleInput(frame) {
        m.inputs.push(frame);
        hooks.handleInput?.(frame);
      },
      covered(by) {
        log.push(`covered:${id}<-${by.id}`);
      },
      uncovered() {
        log.push(`uncovered:${id}`);
      },
    };
    return m;
  };

  return { events, rec, log, modes, mode };
}

const changes = (rec: ReturnType<typeof setup>['rec']): string[] =>
  rec.ofType('modeChanged').map((e) => `${e.from}->${e.to}`);

describe('ModeStack', () => {
  it('push enters the mode, covers the old top, and emits modeChanged', () => {
    const { modes, mode, log, rec } = setup();
    const matrix = mode('matrix', true);
    const deck = mode('deckPanel');
    modes.push(matrix);
    modes.push(deck);

    expect(modes.ids()).toEqual(['matrix', 'deckPanel']);
    expect(modes.top).toBe(deck);
    expect(modes.size).toBe(2);
    expect(modes.has('matrix')).toBe(true);
    expect(log).toEqual(['enter:matrix', 'covered:matrix<-deckPanel', 'enter:deckPanel']);
    expect(changes(rec)).toEqual(['matrix->deckPanel']);
    expect(deck.ctx).toBe(modes.ctx);
    expect(deck.ctx?.modes).toBe(modes);
  });

  it('pop exits the top, uncovers the next, and emits modeChanged', () => {
    const { modes, mode, log, rec } = setup();
    modes.push(mode('matrix', true));
    modes.push(mode('simstim'));
    log.length = 0;
    modes.pop();
    expect(modes.ids()).toEqual(['matrix']);
    expect(log).toEqual(['exit:simstim', 'uncovered:matrix']);
    expect(changes(rec)).toEqual(['matrix->simstim', 'simstim->matrix']);
    modes.pop();
    expect(modes.size).toBe(0);
    expect(changes(rec)).toHaveLength(2);
    expect(() => modes.pop()).toThrow(/empty/);
  });

  it('replace swaps the top without covering; reset exits everything top first', () => {
    const { modes, mode, log, rec } = setup();
    modes.push(mode('boot'));
    modes.replace(mode('title'));
    expect(modes.ids()).toEqual(['title']);
    modes.replace(mode('matrix', true));
    modes.push(mode('deckPanel'));
    log.length = 0;
    modes.reset(mode('jackOut'));
    expect(modes.ids()).toEqual(['jackOut']);
    expect(log).toEqual(['exit:deckPanel', 'exit:matrix', 'enter:jackOut']);
    expect(changes(rec)).toEqual([
      'boot->title',
      'title->matrix',
      'matrix->deckPanel',
      'deckPanel->jackOut',
    ]);
    modes.reset();
    expect(modes.size).toBe(0);
  });

  it('rejects pushing a mode instance that is already on the stack', () => {
    const { modes, mode } = setup();
    const matrix = mode('matrix');
    modes.push(matrix);
    expect(() => modes.push(matrix)).toThrow(/already/);
  });

  describe('simulatesWhenCovered', () => {
    it('covered modes that simulate keep updating; others freeze', () => {
      const { modes, mode, log } = setup();
      const matrix = mode('matrix', true);
      const breach = mode('breach', false);
      const deck = mode('deckPanel', false);
      modes.push(matrix);
      modes.push(breach);
      modes.push(deck);
      log.length = 0;

      modes.update(1 / 60);
      // breach doesn't simulate when covered, so it and everything below it freeze.
      expect(log).toEqual(['update:deckPanel']);
      expect(modes.isSimulating(deck)).toBe(true);
      expect(modes.isSimulating(breach)).toBe(false);
      expect(modes.isSimulating(matrix)).toBe(false);

      modes.pop();
      log.length = 0;
      modes.update(1 / 60);
      expect(log).toEqual(['update:matrix', 'update:breach']);

      modes.pop();
      modes.push(mode('simstim'));
      log.length = 0;
      modes.update(1 / 60);
      // Matrix keeps simulating under the simstim overlay, updated bottom first.
      expect(log).toEqual(['update:matrix', 'update:simstim']);
      expect(modes.isSimulating(matrix)).toBe(true);
    });

    it('a chain of simulating modes all update', () => {
      const { modes, mode } = setup();
      const a = mode('matrix', true);
      const b = mode('simstim', true);
      const c = mode('deckPanel', false);
      modes.push(a);
      modes.push(b);
      modes.push(c);
      for (let i = 0; i < 3; i++) modes.update(1 / 60);
      expect([a.updates, b.updates, c.updates]).toEqual([3, 3, 3]);
    });

    it('the top mode always updates regardless of its own flag', () => {
      const { modes, mode } = setup();
      const top = mode('title', false);
      modes.push(top);
      modes.update(1 / 60);
      expect(top.updates).toBe(1);
    });
  });

  it('only the top mode receives input', () => {
    const { modes, mode } = setup();
    const matrix = mode('matrix', true);
    const deck = mode('deckPanel');
    modes.push(matrix);
    modes.push(deck);
    modes.handleInput('frame-1');
    expect(deck.inputs).toEqual(['frame-1']);
    expect(matrix.inputs).toEqual([]);
  });

  it('renders every mode, bottom first, including frozen ones', () => {
    const { modes, mode, log } = setup();
    modes.push(mode('matrix', false));
    modes.push(mode('deckPanel'));
    log.length = 0;
    modes.render(0.5);
    expect(log).toEqual(['render:matrix', 'render:deckPanel']);
  });

  it('defers transitions requested during update until the pass finishes', () => {
    const { modes, mode, log, rec } = setup();
    const breach = mode('breach');
    const matrix = mode('matrix', true, {
      update: () => {
        if (!modes.has('breach')) modes.push(breach);
      },
    });
    const simstim = mode('simstim', false);
    modes.push(matrix);
    modes.push(simstim);
    log.length = 0;

    modes.update(1 / 60);
    // simstim still updated this step even though matrix pushed breach mid-pass.
    expect(log).toEqual([
      'update:matrix',
      'update:simstim',
      'covered:simstim<-breach',
      'enter:breach',
    ]);
    expect(modes.ids()).toEqual(['matrix', 'simstim', 'breach']);
    expect(changes(rec).at(-1)).toBe('simstim->breach');
  });

  it('applies transitions requested from enter/exit in order, after the current one', () => {
    const { modes, mode, log } = setup();
    const title = mode('title');
    const boot = mode('boot', false, {
      enter: (ctx) => ctx.modes.replace(title),
    });
    modes.push(boot);
    expect(modes.ids()).toEqual(['title']);
    expect(log).toEqual(['enter:boot', 'exit:boot', 'enter:title']);
  });

  it('lets a mode pop itself from handleInput', () => {
    const { modes, mode } = setup();
    const matrix = mode('matrix', true);
    const deck = mode('deckPanel', false, {
      handleInput: () => deck.ctx!.modes.pop(),
    });
    modes.push(matrix);
    modes.push(deck);
    modes.handleInput(null);
    expect(modes.top).toBe(matrix);
  });

  it('recovers when a mode callback throws', () => {
    const { modes, mode } = setup();
    const bad = mode('flatline', false, {
      enter: (ctx) => {
        ctx.modes.push(mode('beach'));
        throw new Error('enter failed');
      },
    });
    expect(() => modes.push(bad)).toThrow('enter failed');
    // The queued push was dropped, and the stack accepts new work.
    expect(modes.ids()).toEqual(['flatline']);
    modes.push(mode('matrix'));
    expect(modes.ids()).toEqual(['flatline', 'matrix']);
  });
});
