import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-7-smpte-raster-crt.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface RasterHandle {
  renderer: {
    postMode: string;
    chain: {
      rasterCrt: {
        playTransition(duration?: number): void;
        stopTransition(): void;
        params: { barrel: number; scanlines: number; grille: number };
        transition: { playing: boolean; duration: number };
      };
    };
  };
}

const handle = (): RasterHandle | undefined =>
  (window as unknown as { __nonspace?: RasterHandle }).__nonspace;

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

test.describe('M1.7 raster CRT', () => {
  test('SMPTE card shows bars, scanlines, grille and curvature at ?lab=raster', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=raster&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'raster');
    await expect(page.getByTestId('raster-crt-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForTimeout(500);

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: RasterHandle }).__nonspace;
      return {
        mode: app.renderer.postMode,
        barrel: app.renderer.chain.rasterCrt.params.barrel,
        scanlines: app.renderer.chain.rasterCrt.params.scanlines,
        grille: app.renderer.chain.rasterCrt.params.grille,
      };
    });
    expect(meta.mode).toBe('simstim');
    expect(meta.barrel).toBeGreaterThan(0.03);
    expect(meta.scanlines).toBeGreaterThan(0);
    expect(meta.grille).toBeGreaterThan(0);

    await page.locator('[data-testid="raster-crt-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    expect(png.width).toBeGreaterThan(600);
    expect(png.height).toBeGreaterThan(300);

    let maxC = 0;
    let lit = 0;
    let yellow = 0;
    let cyan = 0;
    let magenta = 0;
    let red = 0;
    let blue = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 20) lit += 1;
      if (r > 80 && g > 80 && b < r * 0.55) yellow += 1;
      if (g > 70 && b > 70 && r < g * 0.7) cyan += 1;
      if (r > 70 && b > 70 && g < r * 0.7) magenta += 1;
      if (r > 90 && g < r * 0.55 && b < r * 0.55) red += 1;
      if (b > 90 && r < b * 0.7 && g < b * 0.7) blue += 1;
    }
    expect(maxC).toBeGreaterThan(80);
    expect(lit).toBeGreaterThan(8_000);
    expect(yellow).toBeGreaterThan(200);
    expect(cyan).toBeGreaterThan(200);
    expect(magenta).toBeGreaterThan(80);
    expect(red).toBeGreaterThan(80);
    expect(blue).toBeGreaterThan(80);

    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    const center = lumaAt(png, cx, cy);
    const corner = lumaAt(png, 8, 8);
    expect(center).toBeGreaterThan(corner + 8);

    // Scanlines: a vertical slice through a bar should vary (240-line structure).
    let vMin = 255;
    let vMax = 0;
    const sx = Math.floor(png.width * 0.18);
    for (let y = Math.floor(png.height * 0.2); y < Math.floor(png.height * 0.55); y++) {
      const l = lumaAt(png, sx, y);
      if (l < vMin) vMin = l;
      if (l > vMax) vMax = l;
    }
    expect(vMax - vMin).toBeGreaterThan(8);

    // Aperture grille: neighbouring columns differ in channel balance.
    let grilleDelta = 0;
    const gy = Math.floor(png.height * 0.35);
    for (let x = Math.floor(png.width * 0.3); x < Math.floor(png.width * 0.7); x++) {
      const i = (gy * png.width + x) * 4;
      const j = i + 4;
      grilleDelta +=
        Math.abs(png.data[i]! - png.data[j]!) + Math.abs(png.data[i + 2]! - png.data[j + 2]!);
    }
    expect(grilleDelta).toBeGreaterThan(40);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });

  test('0.3 s H-hold / static / tracking transition plays without errors', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=raster&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);

    const started = await page.evaluate(() => {
      const pass = (window as unknown as { __nonspace: RasterHandle }).__nonspace.renderer.chain
        .rasterCrt;
      pass.playTransition(0.3);
      return { playing: pass.transition.playing, duration: pass.transition.duration };
    });
    expect(started.playing).toBe(true);
    expect(started.duration).toBeCloseTo(0.3);

    await page.waitForTimeout(400);

    const done = await page.evaluate(() => {
      const pass = (window as unknown as { __nonspace: RasterHandle }).__nonspace.renderer.chain
        .rasterCrt;
      return pass.transition.playing;
    });
    expect(done).toBe(false);
    expect(errors).toEqual([]);
  });
});
