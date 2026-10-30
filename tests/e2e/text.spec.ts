import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m3-1-text.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface TextHandle {
  renderer: { caps: { renderer: string } };
  textLab: {
    scene: string;
    hersheyCapPx: number;
    vfdGhost: number;
    ascii: string;
    lastGpuMs: number | null;
    setScene(scene: string): void;
  };
}

const handle = (): TextHandle | undefined =>
  (window as unknown as { __nonspace?: TextHandle }).__nonspace;

function litStats(png: PNG): { max: number; lit: number } {
  let max = 0;
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    if (m > max) max = m;
    if (m > 16) lit++;
  }
  return { max, lit };
}

test.describe('M3.1 text rendering', () => {
  test('all three systems draw at ?lab=text', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/?lab=text&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'text');
    await expect(page.getByTestId('text-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForTimeout(500);

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: TextHandle }).__nonspace;
      return {
        cap: app.textLab.hersheyCapPx,
        ghost: app.textLab.vfdGhost,
        ascii: app.textLab.ascii.length,
        gpu: app.renderer.caps.renderer,
      };
    });
    expect(meta.cap).toBe(16);
    expect(meta.ghost).toBeCloseTo(0.06, 6);
    expect(meta.ascii).toBe(95);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    const all = litStats(png);
    expect(all.max).toBeGreaterThan(40);
    expect(all.lit).toBeGreaterThan(400);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    await page.evaluate(() => {
      (window as unknown as { __nonspace: TextHandle }).__nonspace.textLab.setScene('hershey');
    });
    await page.waitForTimeout(250);
    const hershey = litStats(PNG.sync.read(await canvas.screenshot()));
    expect(hershey.lit).toBeGreaterThan(80);

    await page.evaluate(() => {
      (window as unknown as { __nonspace: TextHandle }).__nonspace.textLab.setScene('bitmap');
    });
    await page.waitForTimeout(250);
    const bitmap = litStats(PNG.sync.read(await canvas.screenshot()));
    expect(bitmap.lit).toBeGreaterThan(40);

    await page.evaluate(() => {
      (window as unknown as { __nonspace: TextHandle }).__nonspace.textLab.setScene('vfd');
    });
    await page.waitForTimeout(250);
    const vfd = litStats(PNG.sync.read(await canvas.screenshot()));
    expect(vfd.lit).toBeGreaterThan(40);

    console.log(JSON.stringify({ gpu: meta.gpu, all, hershey, bitmap, vfd }));
    expect(errors).toEqual([]);
  });
});
