import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m6-3-straylight-crt.png',
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
    debug: { clock: string; line: string; waiting: boolean; pain: number };
    setFlipped(on: boolean): void;
    crack(ice: string): void;
    reset(): void;
  };
  renderer: {
    postMode: string;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

interface StrayHandle {
  scene: string;
  injury: boolean;
  word: string;
  gates: string;
  line: string;
  stats: { hall: number; stair: number; gallery: number; head: number };
  seek(t: number): void;
  sync(): void;
}

const handle = (): StimHandle | undefined =>
  (window as unknown as { __nonspace?: StimHandle }).__nonspace;

const stray = (): StrayHandle | undefined =>
  (window as unknown as { __nonspaceStraylight?: StrayHandle }).__nonspaceStraylight;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: StimHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: StimHandle }).__nonspace;
    const s = (window as unknown as { __nonspaceStraylight?: StrayHandle }).__nonspaceStraylight;
    s?.sync();
    app?.renderer.endFrame(1 / 60, null);
  });
}

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

test.describe('M6.3 Straylight simstim content', () => {
  // One Straylight WebGL context at a time — raster-CRT + siblings starve
  // SwiftShader workers if this file runs in parallel with Sense/Net / grid.
  test.describe.configure({ mode: 'serial' });

  test('villa boots through the raster CRT at 320×240', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&scene=straylight&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'simstim');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'straylight');
    await expect(page.getByTestId('simstim-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForFunction(stray);

    await freezeLoop(page);
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      const s = (window as unknown as { __nonspaceStraylight: StrayHandle }).__nonspaceStraylight;
      app.simstim.reset();
      s.seek(0.4);
    });
    await drawOnce(page);

    const stats = await page.evaluate(() => {
      const s = (window as unknown as { __nonspaceStraylight: StrayHandle }).__nonspaceStraylight;
      return s.stats;
    });
    expect(stats.hall).toBeGreaterThan(80);
    expect(stats.stair).toBeGreaterThan(80);
    expect(stats.gallery).toBeGreaterThan(40);
    expect(stats.head).toBeGreaterThan(40);
    expect(stats.hall).toBeLessThanOrEqual(3000);
    expect(stats.stair).toBeLessThanOrEqual(3000);
    expect(stats.gallery).toBeLessThanOrEqual(3000);
    expect(stats.head).toBeLessThanOrEqual(3000);

    await page.locator('[data-testid="simstim-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.setFlipped(true);
    });
    await drawOnce(page);

    const flipped = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { mode: app.renderer.postMode, clock: app.simstim.debug.clock };
    });
    expect(flipped.mode).toBe('simstim');
    expect(flipped.clock).toMatch(/^04:12:\d{2}$/);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);

    let lit = 0;
    let cream = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 18) lit += 1;
      if (r > 40 && g > 36 && b > 28 && r >= b) cream += 1;
    }
    expect(maxC).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(8_000);
    expect(cream).toBeGreaterThan(20);

    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    expect(lumaAt(png, cx, cy)).toBeGreaterThan(lumaAt(png, 8, 8) - 2);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });

  test('M5 gates hit on time and the injury segment transfers pain', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&scene=straylight');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'straylight');
    await page.waitForFunction(handle);
    await page.waitForFunction(stray);
    await freezeLoop(page);

    const walked = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      const s = (window as unknown as { __nonspaceStraylight: StrayHandle }).__nonspaceStraylight;
      app.simstim.setFlipped(true);
      s.seek(2.5);
      app.simstim.crack('straylight-hall');
      s.sync();
      s.seek(7.5);
      app.simstim.crack('straylight-stair');
      s.sync();
      s.seek(8.3);
      s.sync();
      const mid = {
        injury: s.injury,
        pain: app.simstim.debug.pain,
        line: s.line,
      };
      s.seek(12.5);
      app.simstim.crack('straylight-gallery');
      s.seek(12.6);
      s.sync();
      return {
        gates: s.gates,
        line: s.line,
        injury: mid.injury,
        pain: mid.pain,
        midLine: mid.line,
      };
    });
    expect(walked.gates).toBe('hit,hit,hit');
    expect(walked.injury).toBe(true);
    expect(walked.pain).toBeGreaterThan(0.4);
    expect(walked.midLine.toLowerCase()).toContain('leg');
    expect(walked.line.toLowerCase()).toContain('molly');

    expect(errors).toEqual([]);
  });

  test('M7 word scene speaks the word at the cameo', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&scene=straylight-m7');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'straylight-m7');
    await page.waitForFunction(handle);
    await page.waitForFunction(stray);
    await freezeLoop(page);

    const spoken = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      const s = (window as unknown as { __nonspaceStraylight: StrayHandle }).__nonspaceStraylight;
      app.simstim.setFlipped(true);
      s.seek(3.5);
      app.simstim.crack('straylight-head');
      s.sync();
      s.seek(7.6);
      app.simstim.crack('straylight-word');
      s.seek(8.3);
      s.sync();
      return { gates: s.gates, line: s.line, word: s.word };
    });
    expect(spoken.gates).toBe('hit,hit');
    expect(spoken.word).toBe('to whom');
    expect(spoken.line.toLowerCase()).toContain('to whom');

    expect(errors).toEqual([]);
  });

  test('?mission=m5 and ?mission=m7 stubs play Straylight timelines', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?mission=m5');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm5');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'straylight');
    await expect(page.getByTestId('simstim-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await freezeLoop(page);
    await drawOnce(page);

    const m5 = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.setFlipped(true);
      return { clock: app.simstim.debug.clock };
    });
    await drawOnce(page);
    const m5Mode = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return app.renderer.postMode;
    });
    expect(m5.clock).toMatch(/^04:12:\d{2}$/);
    expect(m5Mode).toBe('simstim');

    await page.goto('/?mission=m7');
    await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm7');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'straylight-m7');
    await page.waitForFunction(handle);
    await freezeLoop(page);
    await drawOnce(page);
    const m7 = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { clock: app.simstim.debug.clock, word: document.getElementById('app')?.dataset.word };
    });
    expect(m7.clock).toMatch(/^04:41:\d{2}$/);
    expect(m7.word).toBe('to whom');

    expect(errors).toEqual([]);
  });
});
