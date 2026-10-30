import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-3-grid.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface GridHandle {
  renderer: {
    caps: { renderer: string };
    info: () => { calls: number };
    internalWidth: number;
    internalHeight: number;
    quality: { latticeRadius: number; tier: string };
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const app = (): GridHandle | undefined =>
  (window as unknown as { __nonspace?: GridHandle }).__nonspace;

interface GridLabHandle {
  update(dt: number): void;
}

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: GridHandle }).__nonspace;
    h?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: GridHandle }).__nonspace;
    const lab = (window as unknown as { __nonspaceGrid?: GridLabHandle }).__nonspaceGrid;
    lab?.update(0);
    h?.renderer.endFrame(1 / 60, null);
  });
}

function stats(png: PNG): { max: number; lit: number; skyMax: number; bottomLit: number } {
  const { width, height, data } = png;
  let max = 0;
  let lit = 0;
  let skyMax = 0;
  let bottomLit = 0;
  // HUD sits top-left over the canvas screenshot; sample sky to the right.
  const skyY1 = Math.floor(height * 0.22);
  const skyX0 = Math.floor(width * 0.42);
  const bottomStart = Math.floor(height * 0.55);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const m = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      if (m > max) max = m;
      if (m > 16) lit++;
      if (y < skyY1 && x >= skyX0 && m > skyMax) skyMax = m;
      if (y >= bottomStart && m > 16) bottomLit++;
    }
  }
  return { max, lit, skyMax, bottomLit };
}

test.describe('M1.3 ground grid and local lattice', () => {
  test('cruise scene draws the infinite grid and lattice', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=grid&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'grid');
    await expect(page.getByTestId('grid-lab')).toBeVisible();
    await page.waitForFunction(app);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspace?: GridHandle }).__nonspace;
      h?.renderer.three.setAnimationLoop(null);
      h?.renderer.endFrame(1 / 60, null);
    });

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const cruise = stats(png);
    expect(cruise.max).toBeGreaterThan(30);
    expect(cruise.lit).toBeGreaterThan(800);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    const count = Number.parseInt(
      (await page.locator('#app').getAttribute('data-lattice-count')) ?? '0',
      10,
    );
    expect(count).toBeGreaterThan(500);
    expect(count).toBeLessThanOrEqual(6000);

    const meta = await page.evaluate(() => {
      const h = (window as unknown as { __nonspace?: GridHandle }).__nonspace;
      return {
        gpu: h?.renderer.caps.renderer ?? '',
        calls: h?.renderer.info().calls ?? -1,
        size: h ? [h.renderer.internalWidth, h.renderer.internalHeight] : [],
        radius: h?.renderer.quality.latticeRadius ?? 0,
      };
    });
    console.log(JSON.stringify({ scene: 'cruise', ...cruise, ...meta, lattice: count }));
    expect(errors).toEqual([]);
  });

  test('graze horizon is black, high altitude still reads, warp bends, lattice is stable', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=grid&scene=graze&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'graze');
    await page.waitForFunction(app);
    await page.waitForTimeout(400);

    const before = Number.parseInt(
      (await page.locator('#app').getAttribute('data-lattice-count')) ?? '0',
      10,
    );
    await page.waitForTimeout(800);
    const after = Number.parseInt(
      (await page.locator('#app').getAttribute('data-lattice-count')) ?? '0',
      10,
    );
    expect(after).toBe(before);

    // Freeze before canvas snapshots. Live graze/high/warp frames on
    // SwiftShader hit the 60s test timeout and starve loop.spec.
    await freezeLoop(page);
    await drawOnce(page);

    const canvas = page.locator('#app > canvas');
    const graze = stats(PNG.sync.read(await canvas.screenshot({ animations: 'allow' })));
    expect(graze.skyMax).toBeLessThan(24);
    expect(graze.bottomLit).toBeGreaterThan(200);
    expect(graze.max).toBeGreaterThan(20);

    await page.getByTestId('grid-scene-high').click();
    await drawOnce(page);
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'high');
    await expect(page.locator('#app')).toHaveAttribute('data-altitude', /5000/);
    const high = stats(PNG.sync.read(await canvas.screenshot({ animations: 'allow' })));
    expect(high.lit).toBeGreaterThan(400);
    expect(high.max).toBeGreaterThan(20);

    await page.getByTestId('grid-scene-warp').click();
    await drawOnce(page);
    await expect(page.locator('#app')).toHaveAttribute('data-warp', '1');
    const warpDelta = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-warp-delta')) ?? '0',
    );
    expect(warpDelta).toBeGreaterThan(5);
    const warp = stats(PNG.sync.read(await canvas.screenshot({ animations: 'allow' })));
    expect(warp.lit).toBeGreaterThan(400);

    console.log(
      JSON.stringify({
        graze,
        high,
        warpLit: warp.lit,
        warpDelta,
        lattice: after,
      }),
    );
    expect(errors).toEqual([]);
  });
});
