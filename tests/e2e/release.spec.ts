import { expect, test, type Page } from '@playwright/test';

/**
 * M8.5 release packaging: version stamp, unsupported APIs, reporter off by
 * default. Freeze / dropPage; no live rAF; no 1080p quality=high.
 */

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

test.describe('release packaging', () => {
  test.describe.configure({ mode: 'serial' });

  test('version stamp is visible on default boot', async ({ page }) => {
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?noloop');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      const stamp = page.getByTestId('version-stamp');
      await expect(stamp).toBeVisible();
      await expect(stamp).toHaveText(/\d+\.\d+\.\d+ · [0-9a-f]+/i);
      await freezeLoop(page);
    } finally {
      await dropPage(page);
    }
  });

  test('does not POST console capture without ?report=', async ({ page }) => {
    const posts: string[] = [];
    await page.route('https://example.test/**', async (route) => {
      posts.push(route.request().url());
      await route.fulfill({ status: 204 });
    });
    try {
      await page.goto('/?noloop');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.evaluate(() => console.error('deck fault'));
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.waitForTimeout(200);
      expect(posts).toEqual([]);
      await freezeLoop(page);
    } finally {
      await dropPage(page);
    }
  });

  test('?report= posts captured console errors', async ({ page }) => {
    const bodies: string[] = [];
    await page.route('https://example.test/ingest', async (route) => {
      bodies.push(route.request().postData() ?? '');
      await route.fulfill({ status: 204, body: '' });
    });
    try {
      await page.goto('/?report=https://example.test/ingest&noloop');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.evaluate(() => console.error('deck fault'));
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await expect.poll(() => bodies.length).toBeGreaterThan(0);
      expect(bodies.some((b) => b.includes('deck fault'))).toBe(true);
      await freezeLoop(page);
    } finally {
      await dropPage(page);
    }
  });

  test('shows unsupported when Worker is missing', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
    });
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'unsupported');
    await expect(page.getByRole('alert')).toContainText('Web Workers');
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.goto('about:blank');
  });
});
