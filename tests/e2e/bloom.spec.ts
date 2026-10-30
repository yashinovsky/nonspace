import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-5-bloom.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface BloomHandle {
  renderer: {
    quality: { tier: string; bloomMips: number };
    caps: { renderer: string };
    chain: {
      getPass(slot: string): {
        radius: number;
        stats: { mips: number; draws: number; cpuMs: number };
      };
    };
    info(): { textures: number; width: number; height: number };
    resize(w: number, h: number, dpr: number): void;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const handle = (): BloomHandle | undefined =>
  (window as unknown as { __nonspace?: BloomHandle }).__nonspace;

function glowCount(png: PNG, lo: number, hi: number): number {
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    if (m > lo && m < hi) n++;
  }
  return n;
}

function sampleHalf(png: PNG, left: boolean): { r: number; g: number; b: number; n: number } {
  const x0 = left ? 0 : Math.floor(png.width / 2);
  const x1 = left ? Math.floor(png.width / 2) : png.width;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const mr = png.data[i]!;
      const mg = png.data[i + 1]!;
      const mb = png.data[i + 2]!;
      if (Math.max(mr, mg, mb) < 40) continue;
      r += mr;
      g += mg;
      b += mb;
      n++;
    }
  }
  return { r: n ? r / n : 0, g: n ? g / n : 0, b: n ? b / n : 0, n };
}

async function freezeLoop(page: Page): Promise<void> {
  // Freeze rAF so Playwright does not wait forever for a dirty WebGL canvas
  // (CI timeout: "waiting for element to be stable" during locator.screenshot).
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: BloomHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: BloomHandle }).__nonspace;
    app?.renderer.endFrame(1 / 60, null);
  });
}

test.describe('M1.5 bloom, halation and tonemap', () => {
  test('hot cube desaturates, bloom radius spreads, 1080p cost is logged', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=render&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);
    await page.waitForTimeout(500);
    await freezeLoop(page);

    const canvas = page.locator('#app > canvas');
    const png1 = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const glow1 = glowCount(png1, 8, 70);
    const left = sampleHalf(png1, true);
    const right = sampleHalf(png1, false);
    expect(left.n).toBeGreaterThan(100);
    expect(right.n).toBeGreaterThan(100);
    // Hot cube (left, intensity 4) is whiter: more blue, closer channel means.
    const leftSpread = Math.max(left.r, left.g, left.b) - Math.min(left.r, left.g, left.b);
    const rightSpread = Math.max(right.r, right.g, right.b) - Math.min(right.r, right.g, right.b);
    expect(leftSpread).toBeLessThan(rightSpread);
    expect(left.b).toBeGreaterThan(right.b);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png1));

    const stats1 = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: BloomHandle }).__nonspace;
      const bloom = app.renderer.chain.getPass('bloom');
      return {
        ...bloom.stats,
        radius: bloom.radius,
        mipsQuality: app.renderer.quality.bloomMips,
        gpu: app.renderer.caps.renderer,
        size: [app.renderer.info().width, app.renderer.info().height],
        textures: app.renderer.info().textures,
      };
    });
    const software = /swiftshader|llvmpipe|softpipe/i.test(stats1.gpu);
    expect(stats1.mipsQuality).toBe(6);
    if (software) {
      expect(stats1.draws).toBe(0);
    } else {
      expect(stats1.mips).toBe(6);
      expect(stats1.draws).toBe(13);
    }

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: BloomHandle }).__nonspace;
      app.renderer.resize(1920, 1080, 1);
    });
    await drawOnce(page);
    const stats1080 = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: BloomHandle }).__nonspace;
      const bloom = app.renderer.chain.getPass('bloom');
      return {
        ...bloom.stats,
        size: [app.renderer.info().width, app.renderer.info().height],
      };
    });
    expect(stats1080.size[0]).toBe(1920);
    expect(stats1080.size[1]).toBe(1080);
    if (software) expect(stats1080.draws).toBe(0);
    else expect(stats1080.draws).toBe(13);
    console.log(
      `M1.5 bloom 1080p cpuMs=${stats1080.cpuMs.toFixed(3)} draws=${stats1080.draws} mips=${stats1080.mips} gpu=${stats1.gpu}`,
    );

    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: BloomHandle }).__nonspace;
      app.renderer.resize(1280, 720, 1);
      app.renderer.chain.getPass('bloom').radius = 2;
    });
    await drawOnce(page);
    const png2 = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const glow2 = glowCount(png2, 8, 70);
    if (!software) expect(glow2).toBeGreaterThan(glow1);
    expect(errors).toEqual([]);
  });
});
