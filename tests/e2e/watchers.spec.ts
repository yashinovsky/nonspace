import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-6-watchers.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface ScreenXy {
  x: number;
  y: number;
}

interface WatcherHandle {
  trace: number;
  exposed: boolean;
  lureRemaining: number;
  traceMul: number;
  blipCount: number;
  yaw: number[];
  lured: boolean[];
  turingScreen: ScreenXy;
  fanScreen: ScreenXy;
  setPlayer(x: number, y: number, z: number): void;
  setTime(t: number): void;
  dropLure(): void;
  clearLures(): void;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const watchers = (): WatcherHandle | undefined =>
  (window as unknown as { __nonspaceWatchers?: WatcherHandle }).__nonspaceWatchers;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceWatchers?: WatcherHandle }).__nonspaceWatchers;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
  });
}

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function region(
  png: PNG,
  cx: number,
  cy: number,
  rx: number,
  ry = rx,
): { mean: number; max: number; lit: number } {
  const x0 = clamp(Math.floor(cx - rx), 0, png.width - 1);
  const x1 = clamp(Math.floor(cx + rx), 0, png.width - 1);
  const y0 = clamp(Math.floor(cy - ry), 0, png.height - 1);
  const y1 = clamp(Math.floor(cy + ry), 0, png.height - 1);
  let sum = 0;
  let max = 0;
  let lit = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = lumaAt(png, x, y);
      sum += m;
      if (m > max) max = m;
      if (m > 18) lit++;
      n++;
    }
  }
  return { mean: n ? sum / n : 0, max, lit };
}

test.describe('M4.6 watchers and sweeps', () => {
  test('vector fans, trace gain, decoy lure; freeze before snapshot', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=watchers');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'watchers');
    await expect(page.getByTestId('watchers-lab')).toBeVisible();
    await page.waitForFunction(watchers);

    await freezeLoop(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceWatchers: WatcherHandle }).__nonspaceWatchers;
      h.setTime(0);
    });
    await paint(page);

    const live = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceWatchers: WatcherHandle }).__nonspaceWatchers;
      return {
        exposed: h.exposed,
        blipCount: h.blipCount,
        turing: h.turingScreen,
        fan: h.fanScreen,
      };
    });
    expect(live.exposed).toBe(true);
    expect(live.blipCount).toBeGreaterThan(0);

    await page.locator('[data-testid="watchers-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(png.width).toBeGreaterThan(600);
    const fan = region(png, live.fan.x, live.fan.y, 70, 80);
    const hub = region(png, live.turing.x, live.turing.y, 40, 40);
    expect(fan.lit + hub.lit).toBeGreaterThan(30);
    expect(Math.max(fan.max, hub.max)).toBeGreaterThan(20);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    await page.locator('[data-testid="watchers-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'visible';
    });

    const afterSweep = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceWatchers: WatcherHandle }).__nonspaceWatchers;
      const before = h.trace;
      h.advance(0.1);
      return { before, after: h.trace, exposed: h.exposed };
    });
    expect(afterSweep.exposed).toBe(true);
    expect(afterSweep.after - afterSweep.before).toBeGreaterThan(0.4);
    expect(afterSweep.after - afterSweep.before).toBeLessThan(0.8);

    const decoy = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceWatchers: WatcherHandle }).__nonspaceWatchers;
      const yaw0 = h.yaw[0]!;
      h.dropLure();
      h.advance(0.8);
      return {
        yaw0,
        yaw: h.yaw[0]!,
        lured: h.lured[0],
        remaining: h.lureRemaining,
        mul: h.traceMul,
        exposed: h.exposed,
      };
    });
    expect(decoy.lured).toBe(true);
    expect(decoy.remaining).toBeGreaterThan(6);
    expect(decoy.mul).toBe(0.5);
    expect(Math.abs(decoy.yaw - decoy.yaw0)).toBeGreaterThan(0.15);
    expect(decoy.exposed).toBe(false);

    expect(errors.filter((e) => !/THREE\.WebGLRenderer/.test(e))).toEqual([]);
  });
});
