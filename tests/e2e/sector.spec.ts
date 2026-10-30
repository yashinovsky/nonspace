import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

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
}

test.describe('M2.3 sector streaming lab', () => {
  test('?lab=sector streams a 5×5 window with landmarks and Manhattan traffic', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=sector&seed=1');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'sector');
    await expect(page.getByTestId('sector-lab')).toContainText('SECTOR');

    await page.waitForFunction(() => {
      const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
      return (h?.loaded ?? 0) >= 1;
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.landmarkCount ?? 0;
        }),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.loaded ?? 0;
        }),
      )
      .toBeGreaterThan(8);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.region ?? '';
        }),
      )
      .toBe('BAMA');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector?: SectorHandle }).__nonspaceSector;
          return h?.trafficManhattan ?? false;
        }),
      )
      .toBe(true);

    await page.waitForTimeout(400);
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
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
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector.jumpTo(
        148,
        72,
        120,
      );
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector;
          return h.currentHash();
        }),
      )
      .toBe(first.hash);

    const hitch = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceSector: SectorHandle }).__nonspaceSector;
      return { max: h.stats.maxMainMs, n: h.stats.hitchesOver4ms, landmarks: h.landmarkCount };
    });
    expect(hitch.landmarks).toBeGreaterThan(0);
    expect(hitch.n).toBe(0);

    expect(errors).toEqual([]);
  });
});
