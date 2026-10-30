import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-8-black-ice.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface BlackIceHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    chain: {
      getPass(slot: string): { grip: number; strength: number; edgeIntensity: number };
    };
  };
}

const handle = (): BlackIceHandle | undefined =>
  (window as unknown as { __nonspace?: BlackIceHandle }).__nonspace;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: BlackIceHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

function rgbAt(png: PNG, x: number, y: number): { r: number; g: number; b: number } {
  const i = (y * png.width + x) * 4;
  return { r: png.data[i]!, g: png.data[i + 1]!, b: png.data[i + 2]! };
}

function classify(png: PNG): {
  centerMax: number;
  amber: number;
  uv: number;
  lit: number;
  edgeUv: number;
} {
  const { width, height, data } = png;
  const c = rgbAt(png, Math.floor(width / 2), Math.floor(height / 2));
  const centerMax = Math.max(c.r, c.g, c.b);
  let amber = 0;
  let uv = 0;
  let lit = 0;
  let edgeUv = 0;
  const edgeBand = Math.max(8, Math.floor(width * 0.04));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > 20) lit++;
      if (r > 40 && r > b && g > 18 && g > b * 0.6) amber++;
      const isUv = b > 28 && b > r * 1.05 && b >= g;
      if (isUv) {
        uv++;
        if (x < edgeBand || x >= width - edgeBand || y < edgeBand || y >= height - edgeBand) {
          edgeUv++;
        }
      }
    }
  }
  return { centerMax, amber, uv, lit, edgeUv };
}

test.describe('M1.8 black ICE mask pipeline', () => {
  test('shard eats the construct; UV edge crawls; grip tendrils overlay', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=blackice&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'blackice');
    await expect(page.getByTestId('black-ice-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForTimeout(400);
    await freezeLoop(page);

    await page.locator('[data-testid="black-ice-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const stats = classify(png);
    console.log(JSON.stringify(stats));

    expect(stats.centerMax).toBeLessThan(18);
    expect(stats.amber).toBeGreaterThan(800);
    expect(stats.uv).toBeGreaterThan(40);
    expect(stats.lit).toBeGreaterThan(1000);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    await page.evaluate(() => {
      const ice = (window as unknown as { __nonspaceBlackIce: { setGrip(g: number): void } })
        .__nonspaceBlackIce;
      const app = (window as unknown as { __nonspace: BlackIceHandle }).__nonspace;
      ice.setGrip(1);
      app.renderer.endFrame(1 / 60, null);
    });
    await expect(page.locator('#app')).toHaveAttribute('data-grip', '1');
    const gripPng = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const grip = classify(gripPng);
    expect(grip.edgeUv).toBeGreaterThan(stats.edgeUv);
    expect(grip.centerMax).toBeLessThan(18);

    expect(errors).toEqual([]);
  });
});
