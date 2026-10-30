import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-2-lightpoints.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.describe('M1.2 lightpoints and traffic', () => {
  test('60k points in one draw, traffic joints, screenshot', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=points&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'points');
    await expect(page.locator('#app')).toHaveAttribute('data-point-count', '60000');
    await expect(page.locator('#app')).toHaveAttribute('data-point-draws', '1');
    await expect(page.locator('#app')).toHaveAttribute('data-min-size', '1.5');

    const joint = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-joint-error')) ?? '1',
    );
    expect(joint).toBeLessThan(1e-4);

    // Freeze before the snapshot. Live 60k-point frames starve sibling
    // SwiftShader workers (loop / grid) if Playwright waits for canvas stability.
    await page.evaluate(() => {
      const app = (
        window as unknown as {
          __nonspace?: {
            renderer: {
              three: { setAnimationLoop(fn: null): void };
              endFrame(dt: number, gpuMs: number | null): void;
            };
          };
        }
      ).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
      app?.renderer.endFrame(1 / 60, null);
    });

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    let maxChannel = 0;
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxChannel) maxChannel = m;
      if (m > 12) lit++;
    }
    expect(maxChannel).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(400);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    const meta = await page.evaluate(() => {
      const app = (
        window as unknown as {
          __nonspace?: {
            renderer: {
              info: () => { calls: number };
              caps: { renderer: string };
              internalWidth: number;
              internalHeight: number;
            };
          };
        }
      ).__nonspace;
      return {
        calls: app?.renderer.info().calls ?? -1,
        gpu: app?.renderer.caps.renderer ?? '',
        size: app ? [app.renderer.internalWidth, app.renderer.internalHeight] : [],
      };
    });
    console.log(JSON.stringify(meta));

    expect(errors).toEqual([]);
  });
});
