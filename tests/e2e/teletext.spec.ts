import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m6-4-teletext-test.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface TeletextHandle {
  renderer: {
    postMode: string;
    chain: { rasterCrt: { source: unknown; params: { scanlines: number; grille: number } } };
  };
  modes: { ids(): string[] };
}

const handle = (): TeletextHandle | undefined =>
  (window as unknown as { __nonspace?: TeletextHandle }).__nonspace;

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

test.describe('M6.4 teletext', () => {
  test('test card shows 8 colours, mosaics, double height through the raster CRT', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=teletext&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'teletext');
    await expect(page.locator('#app')).toHaveAttribute('data-knot', 'start');
    await expect(page.getByTestId('teletext-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForTimeout(500);

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: TeletextHandle }).__nonspace;
      return {
        mode: app.renderer.postMode,
        ids: app.modes.ids(),
        hasSource: app.renderer.chain.rasterCrt.source !== null,
        scanlines: app.renderer.chain.rasterCrt.params.scanlines,
        grille: app.renderer.chain.rasterCrt.params.grille,
      };
    });
    expect(meta.mode).toBe('interlude');
    expect(meta.ids).toContain('interlude');
    expect(meta.hasSource).toBe(true);
    expect(meta.scanlines).toBeGreaterThan(0);
    expect(meta.grille).toBeGreaterThan(0);

    await page.locator('[data-testid="teletext-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    expect(png.width).toBeGreaterThan(600);
    expect(png.height).toBeGreaterThan(300);

    let maxC = 0;
    let lit = 0;
    let red = 0;
    let green = 0;
    let yellow = 0;
    let blue = 0;
    let magenta = 0;
    let cyan = 0;
    let white = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 20) lit += 1;
      if (r > 90 && g < r * 0.55 && b < r * 0.55) red += 1;
      if (g > 90 && r < g * 0.55 && b < g * 0.7) green += 1;
      if (r > 80 && g > 80 && b < r * 0.55) yellow += 1;
      if (b > 90 && r < b * 0.7 && g < b * 0.7) blue += 1;
      if (r > 70 && b > 70 && g < r * 0.7) magenta += 1;
      if (g > 70 && b > 70 && r < g * 0.7) cyan += 1;
      // Raster CRT scanlines/grille pull peak white well below 255.
      if (r > 90 && g > 90 && b > 80 && Math.abs(r - g) < 40 && Math.abs(g - b) < 50) white += 1;
    }

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(maxC).toBeGreaterThan(80);
    expect(lit).toBeGreaterThan(8_000);
    expect(red).toBeGreaterThan(80);
    expect(green).toBeGreaterThan(40);
    expect(yellow).toBeGreaterThan(80);
    expect(blue).toBeGreaterThan(80);
    expect(magenta).toBeGreaterThan(40);
    expect(cyan).toBeGreaterThan(80);
    expect(white).toBeGreaterThan(40);

    // Geometric centre is a dark gutter (skyline left, phone right). Compare a
    // colour-bar sample (row 4, ~18% down) to the vignetted corner.
    const bar = lumaAt(png, Math.floor(png.width * 0.22), Math.floor(png.height * 0.22));
    expect(bar).toBeGreaterThan(lumaAt(png, 8, 8) + 4);

    let vMin = 255;
    let vMax = 0;
    const sx = Math.floor(png.width * 0.5);
    for (let y = Math.floor(png.height * 0.15); y < Math.floor(png.height * 0.4); y++) {
      const l = lumaAt(png, sx, y);
      if (l < vMin) vMin = l;
      if (l > vMax) vMax = l;
    }
    expect(vMax - vMin).toBeGreaterThan(8);

    expect(errors).toEqual([]);
  });

  test('Ink choices 1–4 change the knot via soft1–soft4', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=teletext&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-knot', 'start');
    await page.waitForFunction(handle);

    // Hold, don't press: Input samples once per sim tick, so a down+up in the
    // same turn is gone before the next frame (see tests/e2e/input.spec.ts).
    await page.keyboard.down('Digit2');
    await expect
      .poll(async () => page.locator('#app').getAttribute('data-knot'), { timeout: 5_000 })
      .toBe('phone');
    await page.keyboard.up('Digit2');
    await expect(page.locator('#app')).toHaveAttribute('data-page', 'phone');
    // Let the sim tick see the key-up before the next press.
    await page.waitForTimeout(120);

    await page.keyboard.down('Digit2');
    await expect.poll(async () => page.locator('#app').getAttribute('data-knot')).toBe('start');
    await page.keyboard.up('Digit2');

    expect(errors).toEqual([]);
  });
});
