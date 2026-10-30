import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-2-heraldry.png',
);
const SCREENSHOT_GRAY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-2-heraldry-gray.png',
);

const LANDMARKS = [
  'ta-straylight',
  'ta-berne',
  'mitsubishi-boa',
  'esfa',
  'sense-net',
  'hosaka',
  'turing-geneva',
  'chiba-node',
  'hosaka-m3',
  'ninsei',
  'chatsubo',
  'cheap-hotel',
] as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface HeraldryHandle {
  id: string;
  grayscale: boolean;
  pulse: { intensity: number; eighth: number };
  stats: { segments: number; triangles: number; points: number };
  setId(id: string): void;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
}

const handle = (): HeraldryHandle | undefined =>
  (window as unknown as { __nonspaceHeraldry?: HeraldryHandle }).__nonspaceHeraldry;

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

test.describe('M2.2 corp heraldry lab', () => {
  test('?lab=heraldry draws each landmark and syncs rhythm to a mock clock', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=heraldry&id=esfa');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'heraldry');
    await expect(page.getByTestId('heraldry-lab')).toContainText('HERALDRY');
    await expect(page.getByTestId('heraldry-gui')).toBeVisible();
    await expect(page.getByTestId('heraldry-gui')).toContainText('landmark');

    await page.waitForFunction(handle);

    for (const id of LANDMARKS) {
      await page.evaluate((next) => {
        (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry.setId(
          next,
        );
      }, id);
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle })
              .__nonspaceHeraldry;
            return g.id;
          }),
        )
        .toBe(id);
      const stats = await page.evaluate(() => {
        const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry;
        return g.stats;
      });
      expect(stats.segments + stats.points).toBeGreaterThan(0);
    }

    await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry;
      g.setId('hosaka');
      g.setTime(0);
    });
    const onBeat = await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry;
      return g.pulse.intensity;
    });
    await page.evaluate(() => {
      (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry.setTime(
        60 / 96 / 2,
      );
    });
    const offBeat = await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry;
      return g.pulse.intensity;
    });
    expect(onBeat).toBeGreaterThan(offBeat);

    await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry;
      g.setId('esfa');
      g.setGrayscale(false);
      g.setTime(0.4);
    });
    await page.waitForTimeout(250);
    const canvas = page.locator('#app > canvas');
    const colorPng = PNG.sync.read(await canvas.screenshot());
    const colorLit = litStats(colorPng);
    expect(colorLit.max).toBeGreaterThan(40);
    expect(colorLit.lit).toBeGreaterThan(200);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(colorPng));

    await page.evaluate(() => {
      (window as unknown as { __nonspaceHeraldry: HeraldryHandle }).__nonspaceHeraldry.setGrayscale(
        true,
      );
    });
    await expect(page.locator('#app')).toHaveAttribute('data-grayscale', '1');
    await page.waitForTimeout(250);
    const grayPng = PNG.sync.read(await canvas.screenshot());
    const grayLit = litStats(grayPng);
    expect(grayLit.max).toBeGreaterThan(30);
    expect(grayLit.lit).toBeGreaterThan(150);
    writeFileSync(SCREENSHOT_GRAY, PNG.sync.write(grayPng));

    // Tweakpane / overlay sit on the canvas bounding box; sample the construct.
    const x0 = Math.floor(grayPng.width * 0.35);
    const x1 = Math.floor(grayPng.width * 0.65);
    const y0 = Math.floor(grayPng.height * 0.3);
    const y1 = Math.floor(grayPng.height * 0.7);
    let chroma = 0;
    let grayLitCenter = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * grayPng.width + x) * 4;
        const r = grayPng.data[i]!;
        const g = grayPng.data[i + 1]!;
        const b = grayPng.data[i + 2]!;
        chroma = Math.max(chroma, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (Math.max(r, g, b) > 16) grayLitCenter++;
      }
    }
    expect(grayLitCenter).toBeGreaterThan(80);
    expect(chroma).toBeLessThan(18);

    expect(errors).toEqual([]);
  });
});
