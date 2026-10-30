import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { withSectorHitchLock } from './swiftshaderLock';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-3-sector-stream.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface SectorHandle {
  loaded: number;
  pending: number;
  region: string;
  coord: string;
  landmarkCount: number;
  trafficManhattan: boolean;
  hashes: Record<string, number>;
  stats: { maxMainMs: number; hitchesOver4ms: number };
  jumpTo(sx: number, sz: number, y?: number): void;
  currentHash(): number | null;
  update(dt: number): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const sector = (): SectorHandle | undefined =>
  (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;

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
    const s = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
    s?.update(1 / 60);
    h?.renderer.endFrame(1 / 60, null);
  });
}

async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const appHandle = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      appHandle?.renderer.three.setAnimationLoop(null);
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

test.describe('M2.3 sector streaming lab', () => {
  test('?lab=sector streams a 5×5 window with landmarks and Manhattan traffic', async ({
    page,
  }) => {
    await withSectorHitchLock(() => runSectorStream(page));
  });
});

async function runSectorStream(page: Page): Promise<void> {
  const errors = collectErrors(page);
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=sector&seed=1');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'sector');
    await expect(page.getByTestId('sector-lab')).toContainText('SECTOR');
    await page.waitForFunction(app);
    await page.waitForFunction(sector);

    // Freeze before any canvas snapshot. Live sector frames + a SwiftShader
    // sibling (render GPU inject) billed one upload slice over 4 ms.
    await freezeLoop(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
      if (h) {
        h.stats.hitchesOver4ms = 0;
        h.stats.maxMainMs = 0;
      }
    });
    await drawOnce(page);

    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.loaded ?? 0;
        });
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.landmarkCount ?? 0;
        });
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.loaded ?? 0;
        });
      })
      .toBeGreaterThan(8);
    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.region ?? '';
        });
      })
      .toBe('BAMA');
    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.trafficManhattan ?? false;
        });
      })
      .toBe(true);

    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    let maxChannel = 0;
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxChannel) maxChannel = m;
      if (m > 16) lit++;
    }
    expect(maxChannel).toBeGreaterThan(20);
    expect(lit).toBeGreaterThan(80);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    const first = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector;
      return { hash: h.currentHash(), hashes: h.hashes, loaded: h.loaded };
    });
    expect(first.hash).not.toBeNull();

    await page.evaluate(() => {
      (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector.jumpTo(
        20,
        200,
        80,
      );
    });
    await drawOnce(page);
    await page.evaluate(() => {
      (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector.jumpTo(
        148,
        72,
        120,
      );
    });
    await expect
      .poll(async () => {
        await drawOnce(page);
        return page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector;
          return h.currentHash();
        });
      })
      .toBe(first.hash);

    const hitch = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector;
      return { max: h.stats.maxMainMs, n: h.stats.hitchesOver4ms, landmarks: h.landmarkCount };
    });
    expect(hitch.landmarks).toBeGreaterThan(0);
    expect(hitch.n).toBe(0);

    expect(errors).toEqual([]);
  } finally {
    await dropPage(page);
  }
}
