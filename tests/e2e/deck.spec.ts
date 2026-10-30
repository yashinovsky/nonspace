import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m3-3-deck.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface DeckHandle {
  scene: string;
  open: boolean;
  tab: string;
  capturing: boolean;
  coordValue: string;
  lastError: string | null;
  lastJump: string | null;
  paused: boolean;
  simTicks: number;
  unlockCalls: number;
  subtitleText: string;
  subtitleSizePx: number;
  bootLines: readonly string[];
  show(scene: string): void;
  setTab(tab: string): void;
  openDeck(): void;
  closeDeck(): void;
  showSettings(): void;
  hideSettings(): void;
  showSubtitle(text: string): void;
  seekBoot(time: number): void;
  pressTitleKey(key: string): void;
  update(dt: number): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  input: { sample(dt: number): unknown };
  modes: { handleInput(frame: unknown): void; update(dt: number): void };
}

const deck = (): DeckHandle | undefined =>
  (window as unknown as { __nonspaceDeck?: DeckHandle }).__nonspaceDeck;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

/** Drain input + sim without rAF. Do not call endFrame (no extra GPU). */
async function pump(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    const d = (window as unknown as { __nonspaceDeck?: DeckHandle }).__nonspaceDeck;
    const frame = app?.input.sample(0);
    if (frame) app?.modes.handleInput(frame);
    app?.modes.update(0);
    d?.update(0);
  });
}

test.describe('M3.3 deck panel and DOM menus', () => {
  test('deck stays live, settings pause, subtitles scale, title unlocks audio', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    // Default quality. Do not use quality=high or 1080p — sibling SwiftShader
    // workers (loop / grid / points) starve if this lab spins the GPU.
    await page.goto('/?lab=deck');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'deck');
    await expect(page.getByTestId('deck-lab')).toBeVisible();
    await page.waitForFunction(deck);
    // Freeze before any snapshot. Paint HUD/DOM with update(0); skip endFrame.
    await freezeLoop(page);

    await expect(page.getByTestId('deck-panel')).toBeVisible();
    await expect(page.getByTestId('deck-tab-COORD')).toBeVisible();
    await expect(page.getByTestId('deck-tab-SOFTS')).toBeVisible();
    await expect(page.getByTestId('deck-tab-LOG')).toBeVisible();
    await expect(page.getByTestId('deck-tab-PING')).toBeVisible();
    await expect(page.getByTestId('deck-tab-STATUS')).toBeVisible();
    await expect(page.getByTestId('deck-crt')).toContainText('COORD>');

    const ticksOpen = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
      const before = d.simTicks;
      for (let i = 0; i < 8; i++) app?.modes.update(1 / 60);
      return { before, after: d.simTicks, paused: d.paused, open: d.open };
    });
    expect(ticksOpen.open).toBe(true);
    expect(ticksOpen.paused).toBe(false);
    expect(ticksOpen.after).toBeGreaterThan(ticksOpen.before);

    await page.keyboard.type('BAMA 0168.25 / 0096.40 / 0420');
    await page.keyboard.press('Enter');
    await pump(page);
    const jumped = await page.evaluate(() => {
      const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
      return { jump: d.lastJump, err: d.lastError, capturing: d.capturing };
    });
    expect(jumped.err).toBeNull();
    expect(jumped.jump).toMatch(/BAMA/i);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.showSettings();
    });
    await expect(page.getByTestId('settings-menu')).toBeVisible();
    for (const id of [
      'reduceFlashing',
      'reduceMotion',
      'holdToToggle',
      'subtitles.enabled',
      'subtitles.size',
      'subtitles.background',
      'phaseLock.visualOnly',
      'phaseLock.widerTolerance',
      'phaseLock.mimicAlways',
      'phaseLock.slowerRekey',
    ]) {
      await expect(page.locator(`[data-field="${id}"]`)).toHaveCount(1);
    }
    const paused = await page.evaluate(() => {
      return (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.paused;
    });
    expect(paused).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.hideSettings();
    });

    await page.evaluate(() => {
      const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
      d.showSubtitle('DIXIE> three-two');
    });
    await expect(page.getByTestId('subtitles-text')).toHaveText('DIXIE> three-two');
    const sizes = await page.evaluate(() => {
      const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
      const app = (window as unknown as { __nonspace: { settings: { update(p: unknown): void } } })
        .__nonspace;
      const medium = d.subtitleSizePx;
      app.settings.update({ subtitles: { size: 'large' } });
      d.update(0);
      const large = d.subtitleSizePx;
      app.settings.update({ subtitles: { size: 'small' } });
      d.update(0);
      const small = d.subtitleSizePx;
      return { small, medium, large };
    });
    expect(sizes.small).toBe(14);
    expect(sizes.medium).toBe(20);
    expect(sizes.large).toBe(28);
    expect(sizes.large).toBeGreaterThan(sizes.small);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.show('title');
    });
    await expect(page.getByTestId('title-screen')).toBeVisible();
    await expect(page.getByTestId('title-prompt')).toContainText('PRESS ANY KEY TO JACK IN');
    await page.keyboard.press('Space');
    const unlocks = await page.evaluate(() => {
      return (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.unlockCalls;
    });
    expect(unlocks).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => {
      const d = (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck;
      d.show('boot');
      d.seekBoot(2.15);
      d.update(0);
    });
    await expect(page.getByTestId('boot-lines')).toContainText('READY.');

    await page.evaluate(() => {
      (window as unknown as { __nonspaceDeck: DeckHandle }).__nonspaceDeck.show('deck');
    });
    await page.locator('[data-testid="deck-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    // Freeze again immediately before screenshot — live rAF through
    // screenshot({ animations: 'allow' }) billed sibling sector/grid hitches.
    await freezeLoop(page);
    const png = PNG.sync.read(await page.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    let lit = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 18) lit++;
    }
    expect(maxC).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(200);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });
});
