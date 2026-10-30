import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  dispose(): void;
}

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
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

test.describe('default boot', () => {
  test.describe.configure({ mode: 'serial' });

  test('boots to a black full-window WebGL2 canvas with no console errors', async ({ page }) => {
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');

      const canvas = page.locator('#app > canvas');
      await expect(canvas).toHaveCount(1);
      const box = await canvas.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });

      const isWebGL2 = await canvas.evaluate(
        (el) => (el as HTMLCanvasElement).getContext('webgl2') !== null,
      );
      expect(isWebGL2).toBe(true);

      await freezeLoop(page);
      const png = PNG.sync.read(await page.screenshot({ animations: 'disabled' }));
      let maxChannel = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        maxChannel = Math.max(maxChannel, png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      }
      expect(maxChannel).toBe(0);

      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('?debug shows an FPS and GPU-ms readout', async ({ page }) => {
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?debug');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');

      const gui = page.getByTestId('debug-gui');
      await expect(gui).toBeVisible();
      await expect(gui).toContainText('fps');
      await expect(gui).toContainText('gpu ms');

      const fpsField = gui.locator('.tp-lblv', { hasText: 'fps' }).first().locator('input');
      await expect
        .poll(async () => Number.parseFloat(await fpsField.inputValue()), { timeout: 10_000 })
        .toBeGreaterThan(0);

      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('shows a friendly page when WebGL2 is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('/');

    await expect(page.locator('#app')).toHaveAttribute('data-status', 'unsupported');
    await expect(page.getByRole('alert')).toContainText('WebGL2');
    await expect(page.getByRole('link', { name: /get\.webgl\.org/ })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.goto('about:blank');
  });
});
