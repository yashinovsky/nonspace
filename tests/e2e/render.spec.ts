import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m0-4-hdr-cube.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface RenderHandle {
  renderer: {
    quality: { tier: string; hdr: boolean; baseScale: number; persistence: boolean };
    dynamicRes: {
      scale: number;
      inject(ms: number | null): void;
      reset(): void;
    };
    setQuality(q: 'auto' | 'low' | 'medium' | 'high'): void;
    info(): {
      textures: number;
      geometries: number;
      programs: number;
      width: number;
      height: number;
    };
    internalWidth: number;
    internalHeight: number;
    effectiveScale: number;
    caps: { hdr: boolean; renderer: string };
  };
}

const handle = (): RenderHandle | undefined =>
  (window as unknown as { __nonspace?: RenderHandle }).__nonspace;

test.describe('M0.4 render skeleton', () => {
  test('HDR cube is tonemapped to screen at ?lab=render', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=render&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'render');
    await page.waitForFunction(handle);

    await page.waitForTimeout(400);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    let maxChannel = 0;
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxChannel) maxChannel = m;
      if (m > 16) lit++;
    }
    expect(maxChannel).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(200);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: RenderHandle }).__nonspace;
      return {
        hdr: app.renderer.quality.hdr,
        capsHdr: app.renderer.caps.hdr,
        gpu: app.renderer.caps.renderer,
        tier: app.renderer.quality.tier,
        size: [app.renderer.internalWidth, app.renderer.internalHeight],
        textures: app.renderer.info().textures,
      };
    });
    console.log(JSON.stringify(meta));
    expect(meta.tier).toBe('high');
    expect(meta.hdr).toBe(true);
    expect(errors).toEqual([]);
  });

  test('quality tier switches at runtime and resizes internals', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=render&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);

    const result = await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      const high = {
        tier: r.quality.tier,
        width: r.internalWidth,
        persistence: r.quality.persistence,
        scale: r.effectiveScale,
      };
      r.setQuality('low');
      const low = {
        tier: r.quality.tier,
        width: r.internalWidth,
        persistence: r.quality.persistence,
        scale: r.effectiveScale,
      };
      r.setQuality('medium');
      return { high, low, medium: r.quality.tier };
    });

    expect(result.high.tier).toBe('high');
    expect(result.low.tier).toBe('low');
    expect(result.low.persistence).toBe(false);
    expect(result.low.scale).toBeCloseTo(2 / 3, 3);
    expect(result.low.width).toBeLessThan(result.high.width);
    expect(result.medium).toBe('medium');
    expect(errors).toEqual([]);
  });

  test('resize and DPR changes do not leak GPU textures', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/?lab=render');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      return r.info();
    });

    for (const [w, h] of [
      [400, 300],
      [1280, 720],
      [1920, 1080],
      [640, 360],
      [800, 600],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(80);
    }

    // Force a DPR-style resize through the public API (Playwright's window dpr is 1).
    await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      r.setQuality('high');
      const api = r as unknown as { resize(w: number, h: number, dpr: number): void };
      api.resize(800, 600, 2);
      api.resize(800, 600, 1);
    });
    await page.waitForTimeout(120);

    const after = await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      return r.info();
    });

    expect(after.textures).toBe(before.textures);
    expect(after.geometries).toBe(before.geometries);
    expect(errors).toEqual([]);
  });

  test('dynamic resolution responds to an injected GPU load', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/?lab=render&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);

    await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      r.dynamicRes.reset();
      r.dynamicRes.inject(20);
    });

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer.dynamicRes
                .scale,
          ),
        { timeout: 8_000 },
      )
      .toBeLessThan(1);

    const dropped = await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      return { scale: r.dynamicRes.scale, height: r.internalHeight };
    });
    expect(dropped.scale).toBeLessThanOrEqual(0.9);

    await page.evaluate(() => {
      const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
      r.dynamicRes.inject(8);
    });
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer.dynamicRes
                .scale,
          ),
        { timeout: 8_000 },
      )
      .toBe(1);

    expect(errors).toEqual([]);
  });
});
