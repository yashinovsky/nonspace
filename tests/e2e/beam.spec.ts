import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m1-1-beams.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface BeamHandle {
  renderer: {
    caps: { renderer: string };
    palette: {
      get(
        index: number,
        out: { r: number; g: number; b: number },
      ): { r: number; g: number; b: number };
      lerpAllTo(rgb: { r: number; g: number; b: number }, t: number): void;
      reset(): void;
    };
  };
  beamLab: {
    scene: string;
    segmentCount: number;
    lastGpuMs: number | null;
    setScene(scene: string): void;
    setWintermute(t: number): void;
  };
}

const handle = (): BeamHandle | undefined =>
  (window as unknown as { __nonspace?: BeamHandle }).__nonspace;

function litStats(png: PNG): { max: number; lit: number; mean: number } {
  let max = 0;
  let lit = 0;
  let sum = 0;
  const n = png.data.length / 4;
  for (let i = 0; i < png.data.length; i += 4) {
    const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    if (m > max) max = m;
    if (m > 16) lit++;
    sum += m;
  }
  return { max, lit, mean: sum / n };
}

test.describe('M1.1 beam line renderer', () => {
  test('palette cubes render at ?lab=beam and recolor live', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=beam&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'beam');
    await expect(page.getByTestId('beam-lab')).toBeVisible();
    await page.waitForFunction(handle);
    await page.waitForTimeout(400);

    const canvas = page.locator('#app > canvas');
    const beforePng = PNG.sync.read(await canvas.screenshot());
    const before = litStats(beforePng);
    expect(before.max).toBeGreaterThan(40);
    expect(before.lit).toBeGreaterThan(200);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(beforePng));

    const segs = await page.evaluate(() => {
      return (window as unknown as { __nonspace: BeamHandle }).__nonspace.beamLab.segmentCount;
    });
    expect(segs).toBeGreaterThan(20);

    await page.getByTestId('beam-wintermute').click();
    await page.waitForTimeout(200);
    const winter = await page.evaluate(() => {
      const out = { r: 0, g: 0, b: 0 };
      (window as unknown as { __nonspace: BeamHandle }).__nonspace.renderer.palette.get(4, out);
      return out;
    });
    expect(winter.r).toBeCloseTo(1, 2);
    expect(winter.g).toBeCloseTo(1, 2);
    expect(winter.b).toBeCloseTo(1, 2);

    const afterPng = PNG.sync.read(await canvas.screenshot());
    const after = litStats(afterPng);
    expect(after.lit).toBeGreaterThan(100);

    expect(errors).toEqual([]);
  });

  test('near-plane and dwell scenes draw without errors', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=beam&scene=near&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(handle);
    await page.waitForTimeout(300);

    const near = litStats(PNG.sync.read(await page.locator('#app > canvas').screenshot()));
    expect(near.max).toBeGreaterThan(20);

    await page.evaluate(() => {
      (window as unknown as { __nonspace: BeamHandle }).__nonspace.beamLab.setScene('dwell');
    });
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __nonspace: BeamHandle }).__nonspace.beamLab.scene,
        ),
      )
      .toBe('dwell');
    await page.waitForTimeout(250);
    const dwell = litStats(PNG.sync.read(await page.locator('#app > canvas').screenshot()));
    expect(dwell.lit).toBeGreaterThan(50);

    // 150k is the AC on a real GPU; SwiftShader cannot screenshot that many
    // instanced quads in the e2e budget. The lattice is unit-tested, and a
    // real GPU can still open `?lab=beam&scene=stress`.
    const gpuName = await page.evaluate(
      () => (window as unknown as { __nonspace: BeamHandle }).__nonspace.renderer.caps.renderer,
    );
    console.log(JSON.stringify({ gpu: gpuName, nearLit: near.lit, dwellLit: dwell.lit }));

    expect(errors).toEqual([]);
  });
});
