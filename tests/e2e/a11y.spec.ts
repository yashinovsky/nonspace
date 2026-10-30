import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface DeckHandle {
  scene: string;
  paused: boolean;
  focusedField: string | null;
  show(scene: string): void;
  showSettings(): void;
  hideSettings(): void;
  handleSettings(frame: unknown): void;
  pressTitleKey(key: string): void;
  update(dt: number): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
  };
  settings: {
    value: { reduceFlashing: boolean; flashingPromptAnswered: boolean; reduceMotion: boolean };
    update(patch: unknown): void;
  };
  input: {
    sample(dt: number): unknown;
    setGamepads(pads: unknown): void;
    listenRebind(target: string, slot?: number): void;
    rebindTarget: string | null;
    bindings: { actions: Record<string, Array<{ type: string; index?: number }>> };
  };
  modes: { handleInput(frame: unknown): void };
  dispose(): void;
}

const deck = (): DeckHandle | undefined =>
  (window as unknown as { __nonspaceDeck?: DeckHandle }).__nonspaceDeck;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
      app?.dispose();
    });
  } catch {
    /* page may already be closing */
  }
  try {
    await page.goto('about:blank');
  } catch {
    /* ignore */
  }
}

test.describe('M8.1 accessibility', () => {
  test('gamepad-only remap UI navigates, toggles, and rebinds', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=deck&scene=settings');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(deck);
    await freezeLoop(page);

    try {
      await expect(page.getByTestId('settings-menu')).toBeVisible();
      const first = await page.evaluate(() => {
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        d.showSettings();
        d.update(0);
        return { field: d.focusedField, paused: d.paused };
      });
      expect(first.paused).toBe(true);
      expect(first.field).toBe('reduceFlashing');

      const afterDown = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        const tap = (index: number | null): void => {
          const buttons = Array.from({ length: 17 }, (_, i) => ({
            pressed: i === index,
            value: i === index ? 1 : 0,
          }));
          app.input.setGamepads([
            { mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons },
          ]);
          const frame = app.input.sample(1 / 60);
          d.handleSettings(frame);
        };
        tap(null);
        tap(13);
        tap(null);
        return d.focusedField;
      });
      expect(afterDown).toBe('reduceMotion');

      const toggled = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        const tap = (index: number | null): void => {
          const buttons = Array.from({ length: 17 }, (_, i) => ({
            pressed: i === index,
            value: i === index ? 1 : 0,
          }));
          app.input.setGamepads([
            { mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons },
          ]);
          const frame = app.input.sample(1 / 60);
          d.handleSettings(frame);
        };
        const before = app.settings.value.reduceMotion;
        tap(0);
        tap(null);
        return { before, after: app.settings.value.reduceMotion, field: d.focusedField };
      });
      expect(toggled.field).toBe('reduceMotion');
      expect(toggled.after).toBe(!toggled.before);

      const rebound = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        const tap = (index: number | null): void => {
          const buttons = Array.from({ length: 17 }, (_, i) => ({
            pressed: i === index,
            value: i === index ? 1 : 0,
          }));
          app.input.setGamepads([
            { mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons },
          ]);
          const frame = app.input.sample(1 / 60);
          d.handleSettings(frame);
        };
        let guard = 0;
        while (d.focusedField !== 'bind.scan' && guard < 80) {
          tap(13);
          tap(null);
          guard += 1;
        }
        const field = d.focusedField;
        tap(0);
        tap(null);
        const listening = app.input.rebindTarget;
        tap(5);
        tap(null);
        return {
          field,
          listening,
          scan: app.input.bindings.actions.scan,
          target: app.input.rebindTarget,
        };
      });
      expect(rebound.field).toBe('bind.scan');
      expect(rebound.listening).toBe('scan');
      expect(rebound.target).toBeNull();
      expect(rebound.scan.some((s) => s.type === 'gamepadButton' && s.index === 5)).toBe(true);

      const closed = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        const tap = (index: number | null): void => {
          const buttons = Array.from({ length: 17 }, (_, i) => ({
            pressed: i === index,
            value: i === index ? 1 : 0,
          }));
          app.input.setGamepads([
            { mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons },
          ]);
          const frame = app.input.sample(1 / 60);
          d.handleSettings(frame);
        };
        tap(1);
        tap(null);
        return d.paused;
      });
      expect(closed).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('first-boot flashing prompt answers from gamepad Y / B', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=deck&scene=title');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(deck);
    await freezeLoop(page);

    try {
      const prompt = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
        app.settings.update({ flashingPromptAnswered: false, reduceFlashing: true });
        d.show('title');
        d.update(0);
        return document.querySelector('[data-testid="title-prompt"]')?.textContent ?? '';
      });
      expect(prompt).toMatch(/REDUCE FLASHING/);

      const yes = await page.evaluate(() => {
        const app = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        const buttons = Array.from({ length: 17 }, (_, i) => ({
          pressed: i === 0,
          value: i === 0 ? 1 : 0,
        }));
        app.input.setGamepads([
          { mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons },
        ]);
        const frame = app.input.sample(1 / 60);
        app.modes.handleInput(frame);
        return {
          answered: app.settings.value.flashingPromptAnswered,
          reduce: app.settings.value.reduceFlashing,
        };
      });
      expect(yes.answered).toBe(true);
      expect(yes.reduce).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
