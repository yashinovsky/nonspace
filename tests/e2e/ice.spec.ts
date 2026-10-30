import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-2-ice.png',
);
const SCREENSHOT_GRAY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-2-ice-gray.png',
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

interface IceHandle {
  scene: string;
  grayscale: boolean;
  lastSfx: readonly string[];
  telegraphFlicker: number;
  grip: number;
  shatterTime: number;
  shatterDuration: number;
  whiteScreen: ScreenXy;
  grayScreen: ScreenXy;
  blackScreen: ScreenXy;
  setGrayscale(on: boolean): void;
  forceTelegraph(): void;
  forceGrip(): void;
  shatter(): void;
  advance(dt: number): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    quality: { persistence: boolean };
  };
}

const ice = (): IceHandle | undefined =>
  (window as unknown as { __nonspaceIce?: IceHandle }).__nonspaceIce;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.endFrame(1 / 60, null);
  });
}

function rgbAt(png: PNG, x: number, y: number): [number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

function lumaAt(png: PNG, x: number, y: number): number {
  const [r, g, b] = rgbAt(png, x, y);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function toLumaPng(src: PNG): PNG {
  const out = new PNG({ width: src.width, height: src.height });
  for (let i = 0; i < src.data.length; i += 4) {
    const y = Math.round(
      0.2126 * src.data[i]! + 0.7152 * src.data[i + 1]! + 0.0722 * src.data[i + 2]!,
    );
    out.data[i] = y;
    out.data[i + 1] = y;
    out.data[i + 2] = y;
    out.data[i + 3] = src.data[i + 3]!;
  }
  return out;
}

function region(
  png: PNG,
  cx: number,
  cy: number,
  rx: number,
  ry = rx,
): { mean: number; max: number; lit: number; n: number } {
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
  return { mean: n ? sum / n : 0, max, lit, n };
}

function afterglowCount(png: PNG): number {
  let n = 0;
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (g > 18 && g > b * 1.12 && g >= r) n++;
  }
  return n;
}

function edgeDark(png: PNG): number {
  const { width, height } = png;
  const band = Math.max(6, Math.floor(width * 0.035));
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      if (lumaAt(png, x, y) < 8) n++;
    }
  }
  return n;
}

test.describe('M4.2 ICE model and visuals', () => {
  test('three classes, telegraph, shatter trails, grip tendrils', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=ice&scene=trio&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'ice');
    await expect(page.getByTestId('ice-lab')).toBeVisible();
    await page.waitForFunction(ice);
    // Freeze before any canvas snapshot. Do not spin live trio frames —
    // nested iceFacet shells + a black-ICE mask blit starve sibling
    // SwiftShader workers (loop / grid / points).
    await freezeLoop(page);
    await drawOnce(page);

    await page.locator('[data-testid="ice-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    const canvas = page.locator('#app > canvas');
    const colorPng = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(colorPng.width).toBeGreaterThan(600);

    const pos = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      return { w: h.whiteScreen, g: h.grayScreen, b: h.blackScreen };
    });
    const white = region(colorPng, pos.w.x, pos.w.y, 90, 110);
    const gray = region(colorPng, pos.g.x, pos.g.y, 90, 110);
    const black = region(colorPng, pos.b.x, pos.b.y, 90, 110);
    expect(white.lit).toBeGreaterThan(40);
    expect(gray.lit).toBeGreaterThan(40);
    expect(white.max).toBeGreaterThan(20);
    expect(gray.lit).not.toBe(white.lit);
    expect(black.mean).toBeLessThan(white.mean);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(colorPng, { deflateLevel: 9 }));

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      h.setGrayscale(true);
    });
    await drawOnce(page);
    const grayShot = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    const luma = toLumaPng(grayShot);
    const gw = region(luma, pos.w.x, pos.w.y, 90, 110);
    const gg = region(luma, pos.g.x, pos.g.y, 90, 110);
    const gb = region(luma, pos.b.x, pos.b.y, 90, 110);
    const lit = [gw.lit, gg.lit, gb.lit].sort((a, b) => a - b);
    expect(lit[2]! - lit[0]!).toBeGreaterThan(20);
    expect(gw.mean).not.toBeCloseTo(gg.mean, 0);
    expect(gb.mean).toBeLessThan(Math.max(gw.mean, gg.mean));
    writeFileSync(SCREENSHOT_GRAY, PNG.sync.write(luma, { deflateLevel: 9 }));

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      h.setGrayscale(false);
      h.forceTelegraph();
      h.advance(0.12);
    });
    await drawOnce(page);
    const tel = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      return { flick: h.telegraphFlicker, sfx: h.lastSfx.slice() };
    });
    expect(tel.flick).toBeGreaterThan(0);
    expect(tel.sfx).toContain('rekeyTelegraph');
    await expect(page.locator('#app')).toHaveAttribute('data-telegraph', '1');

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      h.shatter();
    });
    for (let s = 0; s < 3; s++) {
      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
        for (let i = 0; i < 12; i++) h.advance(1 / 60);
      });
      await drawOnce(page);
    }
    const sh = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      return { t: h.shatterTime, dur: h.shatterDuration, sfx: h.lastSfx.slice() };
    });
    expect(sh.dur).toBeCloseTo(1.2);
    expect(sh.t).toBeGreaterThan(0.4);
    expect(sh.t).toBeLessThan(1.2);
    expect(sh.sfx).toContain('shatter');
    const shatterPng = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(
      afterglowCount(shatterPng) + region(shatterPng, pos.w.x, pos.w.y, 140, 160).lit,
    ).toBeGreaterThan(30);

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      const left = h.shatterDuration - Math.max(h.shatterTime, 0) + 0.05;
      const n = Math.max(1, Math.ceil(left * 60));
      for (let i = 0; i < n; i++) h.advance(1 / 60);
    });
    const done = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      return h.shatterTime;
    });
    expect(done < 0 || done >= 1.2).toBe(true);

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceIce: IceHandle }).__nonspaceIce;
      h.forceGrip();
      for (let i = 0; i < 36; i++) h.advance(1 / 60);
    });
    await drawOnce(page);
    await expect(page.locator('#app')).toHaveAttribute('data-grip', '1');
    const gripPng = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(edgeDark(gripPng)).toBeGreaterThan(80);

    expect(errors).toEqual([]);
  });
});
