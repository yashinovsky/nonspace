import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-4-phosphor-trails.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface PersistHandle {
  renderer: {
    quality: { persistence: boolean; tier: string };
    setQuality(q: 'auto' | 'low' | 'medium' | 'high'): void;
    info(): { textures: number };
  };
  settings: {
    value: { reduceMotion: boolean };
    update(patch: { reduceMotion?: boolean }): void;
  };
}

const handle = (): PersistHandle | undefined =>
  (window as unknown as { __nonspace?: PersistHandle }).__nonspace;

function classify(png: PNG): { afterglow: number; grid: number; lit: number; cornerMax: number } {
  let afterglow = 0;
  let grid = 0;
  let lit = 0;
  const { width, height, data } = png;
  const corner = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
  };
  const cornerMax = Math.max(
    corner(2, 2),
    corner(width - 3, 2),
    corner(2, height - 3),
    corner(width - 3, height - 3),
  );
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > 16) lit++;
    if (g > 18 && g > b * 1.15 && g >= r) afterglow++;
    if (b > 18 && b > g) grid++;
  }
  return { afterglow, grid, lit, cornerMax };
}

test.describe('M1.4 phosphor persistence', () => {
  test('moving GRID bars leave yellow-green trails at ?lab=persist', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=persist&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'persist');
    await page.waitForFunction(handle);
    await expect(page.locator('#app')).toHaveAttribute('data-persist-on', '1');
    await expect(page.getByTestId('persist-lab')).toBeVisible();

    await page.waitForTimeout(700);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    const stats = classify(png);
    console.log(JSON.stringify(stats));

    expect(stats.lit).toBeGreaterThan(200);
    expect(stats.grid).toBeGreaterThan(40);
    expect(stats.afterglow).toBeGreaterThan(40);
    expect(stats.cornerMax).toBeLessThan(8);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    expect(errors).toEqual([]);
  });

  test('Reduce Motion and Low quality disable trails', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=persist&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-persist-on', '1');
    await page.waitForFunction(handle);

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: PersistHandle }).__nonspace;
      app.settings.update({ reduceMotion: true });
    });
    await expect(page.locator('#app')).toHaveAttribute('data-persist-on', '0');

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: PersistHandle }).__nonspace;
      app.settings.update({ reduceMotion: false });
      app.renderer.setQuality('low');
    });
    await expect(page.locator('#app')).toHaveAttribute('data-persist-on', '0');

    expect(errors).toEqual([]);
  });
});
