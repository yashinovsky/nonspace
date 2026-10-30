import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * M8.2: Low-tier RGBA8 fallback on a no-float-RT browser config, plus the
 * §8.7 quality knobs this environment can prove. Uses `?noloop` so App never
 * starts rAF (SwiftShader); paints with endFrame; dropPage in finally.
 * Does not spin 1080p High or share the sector hitch lock (#48).
 */

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
    quality: {
      tier: string;
      hdr: boolean;
      persistence: boolean;
      bloomMips: number;
      latticeRadius: number;
      baseScale: number;
      maxLineSegments: number;
      maxPoints: number;
      allowRgba8Fallback: boolean;
    };
    caps: { hdr: boolean; renderer: string };
    targets: { hdr: boolean };
    dynamicRes: { scale: number };
    info(): { calls: number; drawCallCap: number; width: number; height: number };
    internalWidth: number;
    internalHeight: number;
    effectiveScale: number;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    setQuality(q: 'auto' | 'low' | 'medium' | 'high'): void;
  };
  dispose(): void;
}

const handle = (): RenderHandle | undefined =>
  (window as unknown as { __nonspace?: RenderHandle }).__nonspace;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: RenderHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: RenderHandle }).__nonspace;
    app?.renderer.endFrame(1 / 60, null);
  });
}

async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: RenderHandle }).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
      app?.dispose();
    });
  } catch {
    /* page may already be closing */
  }
  try {
    await page.goto('about:blank');
  } catch {
    /* ignore */
  }
}

async function stubNoFloatRt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ctor = (
      globalThis as unknown as { WebGL2RenderingContext?: typeof WebGL2RenderingContext }
    ).WebGL2RenderingContext;
    if (!ctor) return;
    const orig = ctor.prototype.getExtension;
    (ctor.prototype as unknown as { getExtension: (name: string) => unknown }).getExtension =
      function (this: WebGL2RenderingContext, name: string) {
        if (name === 'EXT_color_buffer_half_float' || name === 'EXT_color_buffer_float') {
          return null;
        }
        return orig.call(this, name as never);
      };
  });
}

test.describe('M8.2 quality / performance', () => {
  // One WebGL context at a time. A live ?lab=render rAF billed sibling
  // SwiftShader workers (loop.spec lag / sky 40k screenshot).
  test.describe.configure({ mode: 'serial' });

  test('Low-tier RGBA8 fallback on a no-float-RT config still paints', async ({ page }) => {
    const errors = collectErrors(page);
    try {
      await stubNoFloatRt(page);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?lab=render&hdr=0&noloop');
      await page.waitForFunction(handle);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await expect(page.locator('#app')).toHaveAttribute('data-lab', 'render');
      await paint(page);

      await expect(page.locator('#app')).toHaveAttribute('data-tier', 'low');
      await expect(page.locator('#app')).toHaveAttribute('data-hdr', '0');

      const meta = await page.evaluate(() => {
        const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
        return {
          tier: r.quality.tier,
          hdr: r.quality.hdr,
          capsHdr: r.caps.hdr,
          targetsHdr: r.targets.hdr,
          persistence: r.quality.persistence,
          bloomMips: r.quality.bloomMips,
          latticeRadius: r.quality.latticeRadius,
          baseScale: r.quality.baseScale,
          allowRgba8: r.quality.allowRgba8Fallback,
          maxLines: r.quality.maxLineSegments,
          maxPoints: r.quality.maxPoints,
          scale: r.effectiveScale,
          dyn: r.dynamicRes.scale,
          calls: r.info().calls,
          cap: r.info().drawCallCap,
          size: [r.internalWidth, r.internalHeight],
        };
      });
      expect(meta.tier).toBe('low');
      expect(meta.hdr).toBe(false);
      expect(meta.capsHdr).toBe(false);
      expect(meta.targetsHdr).toBe(false);
      expect(meta.persistence).toBe(false);
      expect(meta.bloomMips).toBe(4);
      expect(meta.latticeRadius).toBe(120);
      expect(meta.allowRgba8).toBe(true);
      expect(meta.maxLines).toBe(40_000);
      expect(meta.maxPoints).toBe(20_000);
      expect(meta.baseScale).toBeCloseTo(2 / 3, 3);
      expect(meta.scale).toBeCloseTo(2 / 3, 3);
      expect(meta.dyn).toBe(1);
      expect(meta.calls).toBeGreaterThan(0);
      expect(meta.calls).toBeLessThanOrEqual(meta.cap);
      expect(meta.cap).toBe(150);
      expect(meta.size[0]).toBeLessThan(1280);

      const canvas = page.locator('#app > canvas');
      // `allow`: do not wait for canvas stability (SwiftShader siblings).
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
      let maxChannel = 0;
      let lit = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
        if (m > maxChannel) maxChannel = m;
        if (m > 16) lit++;
      }
      expect(maxChannel).toBeGreaterThan(40);
      expect(lit).toBeGreaterThan(200);
      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('runtime quality switch still resizes and stays under the draw-call cap', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?lab=render&quality=medium&noloop');
      await page.waitForFunction(handle);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await paint(page);

      const result = await page.evaluate(() => {
        const r = (window as unknown as { __nonspace: RenderHandle }).__nonspace.renderer;
        r.setQuality('low');
        r.endFrame(1 / 60, null);
        const low = {
          tier: r.quality.tier,
          persist: r.quality.persistence,
          scale: r.effectiveScale,
          calls: r.info().calls,
          cap: r.info().drawCallCap,
        };
        r.setQuality('high');
        r.endFrame(1 / 60, null);
        const high = {
          tier: r.quality.tier,
          persist: r.quality.persistence,
          scale: r.effectiveScale,
          calls: r.info().calls,
        };
        return { low, high };
      });
      expect(result.low.tier).toBe('low');
      expect(result.low.persist).toBe(false);
      expect(result.low.scale).toBeCloseTo(2 / 3, 3);
      expect(result.low.calls).toBeLessThanOrEqual(result.low.cap);
      expect(result.high.tier).toBe('high');
      expect(result.high.persist).toBe(true);
      expect(result.high.scale).toBe(1);
      expect(result.high.calls).toBeLessThanOrEqual(150);
      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
