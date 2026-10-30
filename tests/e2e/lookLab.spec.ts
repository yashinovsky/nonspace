import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-9-look-lab.png',
);
const SCREENSHOT_GRAY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-9-look-lab-gray.png',
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

interface LookHandle {
  grayscale: boolean;
  time: number;
  fps: number;
  stats: { segments: number; dwell: number; lattice: number; traffic: number; sky: number };
  iceScreen: ScreenXy;
  baitScreen: ScreenXy;
  esfaScreen: ScreenXy;
  mitsuScreen: ScreenXy;
  taScreen: ScreenXy;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
  resetPose(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    resize(w: number, h: number, dpr: number): void;
    quality: { tier: string; persistence: boolean };
    caps: { renderer: string };
    info(): { width: number; height: number; calls: number };
  };
  loop: { stats: { ticks: number; frames: number } };
}

const look = (): LookHandle | undefined =>
  (window as unknown as { __nonspaceLook?: LookHandle }).__nonspaceLook;

const app = (): AppHandle | undefined =>
  (window as unknown as { __nonspace?: AppHandle }).__nonspace;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.endFrame(1 / 60, null);
  });
}

function rgbAt(png: PNG, x: number, y: number): [number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function cornerMax(png: PNG, inset = 8): number {
  const { width, height, data } = png;
  const block = (x0: number, y0: number): number => {
    let m = 0;
    for (let y = y0; y < y0 + inset; y++) {
      for (let x = x0; x < x0 + inset; x++) {
        const i = (y * width + x) * 4;
        m = Math.max(m, data[i]!, data[i + 1]!, data[i + 2]!);
      }
    }
    return m;
  };
  return Math.max(
    block(0, 0),
    block(width - inset, 0),
    block(0, height - inset),
    block(width - inset, height - inset),
  );
}

function region(
  png: PNG,
  cx: number,
  cy: number,
  r: number,
): { max: number; mean: number; lit: number } {
  const x0 = clamp(Math.floor(cx - r), 0, png.width - 1);
  const x1 = clamp(Math.floor(cx + r), 0, png.width - 1);
  const y0 = clamp(Math.floor(cy - r), 0, png.height - 1);
  const y1 = clamp(Math.floor(cy + r), 0, png.height - 1);
  let max = 0;
  let sum = 0;
  let lit = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = Math.max(...rgbAt(png, x, y));
      if (m > max) max = m;
      sum += m;
      if (m > 18) lit++;
      n++;
    }
  }
  return { max, mean: n ? sum / n : 0, lit };
}

function classify(png: PNG): {
  lit: number;
  max: number;
  afterglow: number;
  skyMedian: number;
  skyGlow: number;
  bottomLit: number;
} {
  const { width, height, data } = png;
  let lit = 0;
  let max = 0;
  let afterglow = 0;
  let bottomLit = 0;
  const sky: number[] = [];
  let skyGlow = 0;
  const skyY1 = Math.floor(height * 0.18);
  const skyX0 = Math.floor(width * 0.42);
  const bottom = Math.floor(height * 0.62);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > max) max = m;
      if (m > 16) lit++;
      if (g > 18 && g > b * 1.12 && g >= r) afterglow++;
      if (y < skyY1 && x >= skyX0) {
        sky.push(m);
        // Horizon glow is a lifted band, not sparse spiral-arm dots.
        if (m > 6 && m < 40) skyGlow++;
      }
      if (y >= bottom && m > 16) bottomLit++;
    }
  }
  sky.sort((a, b) => a - b);
  const skyMedian = sky.length ? sky[Math.floor(sky.length / 2)]! : 0;
  return { lit, max, afterglow, skyMedian, skyGlow, bottomLit };
}

function toGrayPng(png: PNG): PNG {
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const y = Math.round(
      0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!,
    );
    out.data[i] = y;
    out.data[i + 1] = y;
    out.data[i + 2] = y;
    out.data[i + 3] = 255;
  }
  return out;
}

test.describe('M1.9 Look Lab', () => {
  test('art checklist at ?lab=look (freeze + screenshot tolerance)', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=look&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'look');
    await expect(page.getByTestId('look-lab')).toBeVisible();
    await page.waitForFunction(look);
    await page.waitForFunction(app);
    await expect(page.locator('#app')).toHaveAttribute('data-persist', '1');
    await expect(page.locator('#app')).toHaveAttribute('data-dwell', /[1-9]/);

    // Let traffic and ICE rotation paint phosphor trails before the freeze.
    await page.waitForTimeout(800);
    await freezeLoop(page);
    await drawOnce(page);

    await page.locator('[data-testid="look-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    expect(png.height).toBeGreaterThan(300);

    const stats = classify(png);
    const corners = cornerMax(png);
    const [cr, cg, cb] = rgbAt(png, 2, 2);
    expect(cr).toBe(0);
    expect(cg).toBe(0);
    expect(cb).toBe(0);
    expect(corners).toBe(0);
    expect(stats.skyMedian).toBeLessThan(4);
    expect(stats.skyGlow / Math.max(png.width * png.height * 0.08, 1)).toBeLessThan(0.12);
    expect(stats.bottomLit).toBeGreaterThan(200);
    expect(stats.lit).toBeGreaterThan(1_200);
    expect(stats.max).toBeGreaterThan(50);
    expect(stats.afterglow).toBeGreaterThan(40);

    const screens = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceLook: LookHandle }).__nonspaceLook;
      return {
        ice: h.iceScreen,
        bait: h.baitScreen,
        esfa: h.esfaScreen,
        mitsu: h.mitsuScreen,
        ta: h.taScreen,
        stats: h.stats,
      };
    });
    expect(screens.stats.dwell).toBeGreaterThan(20);
    expect(screens.stats.segments).toBeGreaterThan(80);
    expect(screens.stats.sky).toBe(2_400);

    const ice = region(png, screens.ice.x, screens.ice.y, 18);
    const bait = region(png, screens.bait.x, screens.bait.y, 18);
    expect(ice.mean).toBeLessThan(bait.mean);
    expect(ice.max).toBeLessThan(40);

    const esfa = region(png, screens.esfa.x, screens.esfa.y, 36);
    const mitsu = region(png, screens.mitsu.x, screens.mitsu.y, 36);
    const ta = region(png, screens.ta.x, screens.ta.y, 36);
    expect(esfa.lit).toBeGreaterThan(30);
    expect(mitsu.lit).toBeGreaterThan(30);
    expect(ta.lit).toBeGreaterThan(20);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    await expect(canvas).toHaveScreenshot('m1-9-look-lab.png', {
      animations: 'allow',
      maxDiffPixelRatio: 0.18,
    });

    await page.evaluate(() => {
      (window as unknown as { __nonspaceLook: LookHandle }).__nonspaceLook.setGrayscale(true);
    });
    await drawOnce(page);
    const grayPng = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const gray = toGrayPng(grayPng);
    const gEsfa = region(gray, screens.esfa.x, screens.esfa.y, 36);
    const gMitsu = region(gray, screens.mitsu.x, screens.mitsu.y, 36);
    const gTa = region(gray, screens.ta.x, screens.ta.y, 36);
    const litSpread =
      Math.max(gEsfa.lit, gMitsu.lit, gTa.lit) - Math.min(gEsfa.lit, gMitsu.lit, gTa.lit);
    expect(gEsfa.lit).toBeGreaterThan(20);
    expect(gMitsu.lit).toBeGreaterThan(20);
    expect(gTa.lit).toBeGreaterThan(10);
    expect(litSpread).toBeGreaterThan(8);
    writeFileSync(SCREENSHOT_GRAY, PNG.sync.write(gray, { deflateLevel: 9 }));

    const meta = await page.evaluate(() => {
      const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
      a.renderer.resize(1920, 1080, 1);
      a.renderer.endFrame(1 / 60, null);
      return {
        tier: a.renderer.quality.tier,
        persist: a.renderer.quality.persistence,
        size: [a.renderer.info().width, a.renderer.info().height],
        gpu: a.renderer.caps.renderer,
        calls: a.renderer.info().calls,
      };
    });
    expect(meta.tier).toBe('medium');
    expect(meta.persist).toBe(true);
    expect(meta.size[0]).toBe(1920);
    expect(meta.size[1]).toBe(1080);
    console.log(
      JSON.stringify({
        scene: 'look',
        ...stats,
        corners,
        ice: ice.mean,
        bait: bait.mean,
        ...meta,
      }),
    );

    expect(errors).toEqual([]);
  });

  test('grayscale toggle and free-fly handle', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=look&quality=medium&gray=1');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'look');
    await expect(page.locator('#app')).toHaveAttribute('data-gray', '1');
    await page.waitForFunction(look);
    await freezeLoop(page);
    const before = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceLook: LookHandle }).__nonspaceLook;
      return { gray: h.grayscale, time: h.time };
    });
    expect(before.gray).toBe(true);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceLook: LookHandle }).__nonspaceLook;
      h.setGrayscale(false);
      h.setTime(1.25);
      h.resetPose();
    });
    await expect(page.locator('#app')).toHaveAttribute('data-gray', '0');
    const after = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceLook: LookHandle }).__nonspaceLook;
      return { gray: h.grayscale, time: h.time };
    });
    expect(after.gray).toBe(false);
    expect(after.time).toBeCloseTo(1.25, 3);
    expect(errors).toEqual([]);
  });
});
