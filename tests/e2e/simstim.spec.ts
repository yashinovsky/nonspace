import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m6-1-simstim-crt.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface StimHandle {
  simstim: {
    flipped: boolean;
    meatTime: number;
    debug: { clock: string; rekeysWhileFlipped: number; waiting: boolean };
    setFlipped(on: boolean): void;
    crack(ice: string): void;
    pain: { hurt(n: number): void; neural: number };
  };
  renderer: { postMode: string; pipEnabled: boolean };
  events: { flush(): void };
}

const handle = (): StimHandle | undefined =>
  (window as unknown as { __nonspace?: StimHandle }).__nonspace;

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

test.describe('M6.1 simstim feed', () => {
  test('lab boots a dithered lobby through the raster CRT with a chip clock', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'simstim');
    await expect(page.getByTestId('simstim-lab')).toBeVisible();
    await page.waitForFunction(handle);

    await page.waitForFunction(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return app.simstim.meatTime > 0.4;
    });

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return {
        clock: app.simstim.debug.clock,
        meat: app.simstim.meatTime,
        pip: app.renderer.pipEnabled,
        mode: app.renderer.postMode,
      };
    });
    expect(meta.clock).toMatch(/^02:14:\d{2}$/);
    expect(meta.meat).toBeGreaterThan(0.4);
    expect(meta.pip).toBe(true);
    expect(meta.mode).toBe('matrix');

    await page.locator('[data-testid="simstim-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.setFlipped(true);
    });
    await page.waitForTimeout(350);

    const flipped = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { mode: app.renderer.postMode, on: app.simstim.flipped };
    });
    expect(flipped.mode).toBe('simstim');
    expect(flipped.on).toBe(true);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    expect(png.width).toBeGreaterThan(600);

    let lit = 0;
    let red = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 18) lit += 1;
      if (r > 40 && r > g + 8 && r > b + 8) red += 1;
    }
    expect(maxC).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(4_000);
    expect(red).toBeGreaterThan(8);

    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    expect(lumaAt(png, cx, cy)).toBeGreaterThan(lumaAt(png, 8, 8) - 4);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });

  test('timeline meat-time, re-key while flipped, gate hit, pain echo', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);

    const before = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { meat: app.simstim.meatTime, flipped: app.simstim.flipped };
    });
    expect(before.flipped).toBe(false);

    await page.waitForTimeout(500);
    const mid = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.setFlipped(true);
      return { meat: app.simstim.meatTime };
    });
    expect(mid.meat).toBeGreaterThan(before.meat);

    await page.waitForFunction(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return app.simstim.debug.rekeysWhileFlipped >= 1;
    });

    const afterFlip = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return {
        meat: app.simstim.meatTime,
        rekeys: app.simstim.debug.rekeysWhileFlipped,
        mode: app.renderer.postMode,
      };
    });
    expect(afterFlip.meat).toBeGreaterThan(mid.meat);
    expect(afterFlip.rekeys).toBeGreaterThanOrEqual(1);
    expect(afterFlip.mode).toBe('simstim');

    const gate = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.crack('sense-net-door');
      return (document.getElementById('app') as HTMLElement).dataset.gate;
    });
    await page.waitForTimeout(80);
    const gate2 = await page.evaluate(
      () => (document.getElementById('app') as HTMLElement).dataset.gate,
    );
    expect(['early', 'hit', 'open', gate, gate2]).toContain(gate2);

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.pain.hurt(0.9);
      app.simstim.setFlipped(false);
    });
    await page.waitForTimeout(50);
    const echo = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { neural: app.simstim.pain.neural, flipped: app.simstim.flipped };
    });
    expect(echo.flipped).toBe(false);
    expect(echo.neural).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
