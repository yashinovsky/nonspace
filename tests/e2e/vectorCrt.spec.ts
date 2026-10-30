import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-6-vector-crt.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface VectorHandle {
  renderer: {
    vectorLoad: number;
    postMode: string;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    resize(w: number, h: number, dpr: number): void;
    chain: {
      vectorCrt: {
        params: {
          enableBarrel: boolean;
          enableJitter: boolean;
          enableFlicker: boolean;
          enableVignette: boolean;
          enableGlass: boolean;
          enableGrain: boolean;
        };
        effectiveFlicker: number;
      };
    };
  };
  settings: {
    value: { reduceFlashing: boolean };
    update(patch: { reduceFlashing?: boolean }): void;
  };
}

const handle = (): VectorHandle | undefined =>
  (window as unknown as { __nonspace?: VectorHandle }).__nonspace;

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

function rgbAt(png: PNG, x: number, y: number): [number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

function cornerRegionMax(png: PNG, inset = 10): number {
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

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: VectorHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: VectorHandle }).__nonspace;
    app?.renderer.endFrame(1 / 60, null);
  });
}

test.describe('M1.6 vector CRT', () => {
  test('barrel, true black, readable strokes at ?lab=vector', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=vector&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'vector');
    await expect(page.getByTestId('vector-crt-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await expect(page.locator('#app')).toHaveAttribute('data-hershey-cap-px', '16');
    await page.waitForTimeout(300);
    await freezeLoop(page);
    await drawOnce(page);

    await page.locator('[data-testid="vector-crt-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    expect(png.height).toBeGreaterThan(300);

    const [cr, cg, cb] = rgbAt(png, 2, 2);
    expect(cr).toBe(0);
    expect(cg).toBe(0);
    expect(cb).toBe(0);
    expect(cornerRegionMax(png)).toBe(0);

    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    expect(lumaAt(png, cx, cy)).toBeGreaterThan(8);

    let lit = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 20) lit += 1;
    }
    expect(maxC).toBeGreaterThan(60);
    expect(lit).toBeGreaterThan(400);

    // Stroke contrast: a horizontal band through the title should mix ink and black.
    let bandLit = 0;
    let bandDark = 0;
    const y0 = Math.floor(png.height * 0.42);
    const y1 = Math.floor(png.height * 0.62);
    for (let y = y0; y < y1; y++) {
      for (let x = Math.floor(png.width * 0.25); x < Math.floor(png.width * 0.75); x++) {
        if (lumaAt(png, x, y) > 30) bandLit += 1;
        else bandDark += 1;
      }
    }
    expect(bandLit).toBeGreaterThan(80);
    expect(bandDark).toBeGreaterThan(80);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: VectorHandle }).__nonspace;
      return {
        mode: app.renderer.postMode,
        flicker: app.renderer.chain.vectorCrt.effectiveFlicker,
        reduce: app.settings.value.reduceFlashing,
        barrel: app.renderer.chain.vectorCrt.params.enableBarrel,
      };
    });
    expect(meta.mode).toBe('matrix');
    expect(meta.barrel).toBe(true);
    expect(meta.reduce).toBe(true);
    expect(meta.flicker).toBe(0);

    expect(errors).toEqual([]);
  });

  test('Reduce flashing zeros flicker; toggles disable barrel', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=vector&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);
    await freezeLoop(page);

    const withFlash = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: VectorHandle }).__nonspace;
      app.settings.update({ reduceFlashing: false });
      app.renderer.vectorLoad = 1;
      app.renderer.endFrame(1 / 60, null);
      return app.renderer.chain.vectorCrt.effectiveFlicker;
    });
    expect(withFlash).toBeGreaterThan(0);
    expect(withFlash).toBeLessThanOrEqual(0.03);

    const reduced = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: VectorHandle }).__nonspace;
      app.settings.update({ reduceFlashing: true });
      app.renderer.endFrame(1 / 60, null);
      return app.renderer.chain.vectorCrt.effectiveFlicker;
    });
    expect(reduced).toBe(0);

    const toggled = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: VectorHandle }).__nonspace;
      const p = app.renderer.chain.vectorCrt.params;
      p.enableBarrel = false;
      p.enableVignette = false;
      p.enableGlass = false;
      p.enableGrain = false;
      p.enableJitter = false;
      p.enableFlicker = false;
      app.renderer.endFrame(1 / 60, null);
      return {
        barrel: p.enableBarrel,
        flicker: app.renderer.chain.vectorCrt.effectiveFlicker,
      };
    });
    expect(toggled.barrel).toBe(false);
    expect(toggled.flicker).toBe(0);

    expect(errors).toEqual([]);
  });

  test('debug GUI exposes per-effect toggles', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=vector&debug&quality=high');
    await expect(page.getByTestId('debug-gui')).toBeVisible();
    const gui = page.getByTestId('debug-gui');
    await expect(gui).toContainText('vector CRT');
    await expect(gui).toContainText('barrel');
    await expect(gui).toContainText('jitter');
    await expect(gui).toContainText('flicker');
    await expect(gui).toContainText('vignette');
    await expect(gui).toContainText('glass');
    await expect(gui).toContainText('grain');
    expect(errors).toEqual([]);
  });
});
