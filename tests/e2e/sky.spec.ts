import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-4-sky-arms.png',
);
const CEILING_SHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-4-sky-ceiling.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

function litStats(png: PNG): { max: number; lit: number; violet: number } {
  let max = 0;
  let lit = 0;
  let violet = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > max) max = m;
    if (m > 12) lit++;
    if (b > 18 && r > 10 && b >= g && r >= g * 0.7) violet++;
  }
  return { max, lit, violet };
}

test.describe('M2.4 sky', () => {
  test('40k points in one draw, 0.1× parallax, unreachable at the ceiling', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=sky&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'sky');
    await expect(page.locator('#app')).toHaveAttribute('data-sky-points', '40000');
    await expect(page.locator('#app')).toHaveAttribute('data-sky-draws', '1');
    await expect(page.locator('#app')).toHaveAttribute('data-sky-parallax', '0.1');
    await expect(page.getByTestId('sky-lab')).toBeVisible();

    await page.waitForTimeout(400);

    const canvas = page.locator('#app > canvas');
    // Ground shot while the loop is still running (`setView` + spin need rAF).
    // `animations: 'allow'` so Playwright does not wait for a dirty canvas.
    const groundPng = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const ground = litStats(groundPng);
    expect(ground.max).toBeGreaterThan(24);
    expect(ground.lit).toBeGreaterThan(300);
    expect(ground.violet).toBeGreaterThan(80);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(groundPng));

    const groundRange = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-range')) ?? '0',
    );
    const groundY = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-cam-y')) ?? '0',
    );
    expect(groundY).toBeLessThan(2_000);
    expect(groundRange).toBeGreaterThan(29_000);

    const angle0 = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-angle')) ?? '0',
    );
    await page.waitForTimeout(1_000);
    const angle1 = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-angle')) ?? '0',
    );
    const dAngle = angle1 - angle0;
    expect(dAngle).toBeGreaterThan(0);
    expect(dAngle).toBeLessThan(0.01);

    await page.evaluate(() => {
      (window as unknown as { __skyLab: { setView(v: string): void } }).__skyLab.setView('ceiling');
    });
    await expect(page.locator('#app')).toHaveAttribute('data-sky-view', 'ceiling');
    await page.waitForTimeout(200);

    const ceilingRange = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-range')) ?? '0',
    );
    const ceilingY = Number.parseFloat(
      (await page.locator('#app').getAttribute('data-sky-cam-y')) ?? '0',
    );
    expect(ceilingY).toBeGreaterThan(11_000);
    expect(ceilingRange).toBeGreaterThan(28_000);
    expect(ceilingRange / groundRange).toBeGreaterThan(0.95);
    expect(ceilingRange / groundRange).toBeLessThan(1);

    // Freeze before the ceiling snapshot — 40k points spinning on SwiftShader
    // starve sibling loop / grid / points workers.
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
    const ceilingPng = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const ceiling = litStats(ceilingPng);
    expect(ceiling.lit).toBeGreaterThan(200);
    writeFileSync(CEILING_SHOT, PNG.sync.write(ceilingPng));

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
            loop: { stats: { ticks: number } };
          };
        }
      ).__nonspace;
      const sky = (
        window as unknown as {
          __skyLab?: { sky: { batch: { drawCount: number } } };
        }
      ).__skyLab;
      return {
        calls: app?.renderer.info().calls ?? -1,
        gpu: app?.renderer.caps.renderer ?? '',
        size: app ? [app.renderer.internalWidth, app.renderer.internalHeight] : [],
        drawCount: sky?.sky.batch.drawCount ?? -1,
      };
    });
    expect(meta.drawCount).toBe(40_000);
    console.log(JSON.stringify({ ...meta, ground, ceiling, groundRange, ceilingRange, dAngle }));

    expect(errors).toEqual([]);
  });
});
