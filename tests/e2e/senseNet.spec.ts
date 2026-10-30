import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m6-2-sensenet-crt.png',
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
    debug: { clock: string; line: string; waiting: boolean };
    setFlipped(on: boolean): void;
    crack(ice: string): void;
  };
  renderer: {
    postMode: string;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

interface SenseHandle {
  scene: string;
  panic: boolean;
  gates: string;
  line: string;
  stats: { lobby: number; corridor: number; vault: number };
  seek(t: number): void;
  sync(): void;
}

const handle = (): StimHandle | undefined =>
  (window as unknown as { __nonspace?: StimHandle }).__nonspace;

const sense = (): SenseHandle | undefined =>
  (window as unknown as { __nonspaceSenseNet?: SenseHandle }).__nonspaceSenseNet;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: StimHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: StimHandle }).__nonspace;
    app?.renderer.endFrame(1 / 60, null);
  });
}

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

test.describe('M6.2 Sense/Net simstim content', () => {
  // One Sense/Net WebGL context at a time — three raster-CRT zones spinning
  // in parallel starve sibling SwiftShader workers (loop / grid / points).
  test.describe.configure({ mode: 'serial' });

  test('lab boots a building through the raster CRT at 320×240', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&quality=high&t=0.8');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'simstim');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'sensenet');
    await expect(page.getByTestId('simstim-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForFunction(sense);

    // Freeze before any canvas snapshot. Do not spin live Sense/Net frames.
    await freezeLoop(page);
    await drawOnce(page);

    const stats = await page.evaluate(() => {
      const s = (window as unknown as { __nonspaceSenseNet: SenseHandle }).__nonspaceSenseNet;
      return s.stats;
    });
    expect(stats.lobby).toBeGreaterThan(80);
    expect(stats.corridor).toBeGreaterThan(80);
    expect(stats.vault).toBeGreaterThan(40);
    expect(stats.lobby).toBeLessThanOrEqual(3000);
    expect(stats.corridor).toBeLessThanOrEqual(3000);
    expect(stats.vault).toBeLessThanOrEqual(3000);

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
    expect(flipped.clock).toMatch(/^00:00:\d{2}$/);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);

    let lit = 0;
    let warm = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 18) lit += 1;
      if (r > 40 && r >= g && g > b + 4) warm += 1;
    }
    expect(maxC).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(8_000);
    expect(warm).toBeGreaterThan(20);

    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    expect(lumaAt(png, cx, cy)).toBeGreaterThan(lumaAt(png, 8, 8) - 2);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });

  test('three gates hit on time along the Sense/Net walk', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);
    await page.waitForFunction(sense);
    await freezeLoop(page);

    const walked = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      const s = (window as unknown as { __nonspaceSenseNet: SenseHandle }).__nonspaceSenseNet;
      app.simstim.setFlipped(true);
      s.seek(2.5);
      app.simstim.crack('sense-net-lobby');
      s.sync();
      s.seek(7.5);
      app.simstim.crack('sense-net-corridor');
      s.sync();
      s.seek(12.5);
      app.simstim.crack('sense-net-vault');
      s.seek(12.6);
      s.sync();
      return { gates: s.gates, line: s.line };
    });
    expect(walked.gates).toBe('hit,hit,hit');
    expect(walked.line.toLowerCase()).toContain('molly');

    expect(errors).toEqual([]);
  });

  test('Panther Moderns panic unhides crowd shapes', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(sense);
    await freezeLoop(page);

    const panic = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      const s = (window as unknown as { __nonspaceSenseNet: SenseHandle }).__nonspaceSenseNet;
      app.simstim.setFlipped(true);
      app.simstim.crack('sense-net-lobby');
      app.simstim.crack('sense-net-corridor');
      app.simstim.crack('sense-net-vault');
      s.seek(10);
      s.sync();
      return s.panic;
    });
    expect(panic).toBe(true);

    expect(errors).toEqual([]);
  });

  test('lab timeline still walks Sense/Net without the campaign route', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=simstim&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'simstim');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'sensenet');
    await page.waitForFunction(handle);
    await freezeLoop(page);

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return { clock: app.simstim.debug.clock, meat: app.simstim.meatTime };
    });
    expect(meta.clock).toMatch(/^00:00:\d{2}$/);

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      app.simstim.setFlipped(true);
    });
    await drawOnce(page);
    const mode = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: StimHandle }).__nonspace;
      return app.renderer.postMode;
    });
    expect(mode).toBe('simstim');

    expect(errors).toEqual([]);
  });
});
