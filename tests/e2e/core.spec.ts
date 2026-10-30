import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-5-core.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface CoreHandle {
  scene: string;
  seed: number;
  strata: number;
  phase: string;
  download: number;
  downloaded: boolean;
  targetPulse: number;
  decoyPulse: number;
  freezeProgress: number;
  frozenLayers: number;
  layerCount: number;
  trace: number;
  nearTarget: boolean;
  target: { x: number; y: number; z: number; code: string };
  setTime(t: number): void;
  holdDownload(seconds: number): void;
  completeDownload(): void;
  startRouteOut(): boolean;
  startJackOut(): boolean;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const core = (): CoreHandle | undefined =>
  (window as unknown as { __nonspaceCore?: CoreHandle }).__nonspaceCore;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceCore?: CoreHandle }).__nonspaceCore;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
  });
}

test.describe('M4.5 core interior', () => {
  test('cathedral, on-beat pulse, download, route-out freeze; freeze before snapshot', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=core&scene=cathedral&seed=1&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'core');
    await expect(page.getByTestId('core-lab')).toBeVisible();
    await page.waitForFunction(core);

    // Freeze before any canvas snapshot. Do not spin a live HUD + CRT rAF —
    // that hung SwiftShader teardown on sibling grid/loop/points specs.
    await freezeLoop(page);
    await paint(page);

    const pulses = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceCore: CoreHandle }).__nonspaceCore;
      h.setTime(0);
      const on = { target: h.targetPulse, decoy: h.decoyPulse, strata: h.strata, seed: h.seed };
      const bpm = 96;
      const half = 60 / bpm / 2;
      h.setTime(half);
      return { on, off: { target: h.targetPulse, decoy: h.decoyPulse } };
    });
    expect(pulses.on.strata).toBe(8);
    expect(pulses.on.seed).toBe(1);
    expect(pulses.on.target).toBeCloseTo(1, 2);
    expect(pulses.on.decoy).toBeCloseTo(0, 2);
    expect(pulses.off.target).toBeCloseTo(0, 2);
    expect(pulses.off.decoy).toBeCloseTo(1, 2);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceCore: CoreHandle }).__nonspaceCore.setTime(0);
    });
    await page.locator('[data-testid="core-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    await paint(page);
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    let lit = 0;
    let maxC = 0;
    let white = 0;
    let black = 0;
    let lumaSum = 0;
    const n = png.data.length / 4;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxC) maxC = m;
      if (m > 18) lit++;
      if (m > 240) white++;
      if (m < 18) black++;
      lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    expect(maxC).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(200);
    // 1984 vector on black — not a white bloom fill.
    expect(lumaSum / n).toBeLessThan(80);
    expect(black / n).toBeGreaterThan(0.35);
    expect(white / n).toBeLessThan(0.08);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    const dl = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceCore: CoreHandle }).__nonspaceCore;
      h.setTime(0);
      h.holdDownload(1.5);
      const mid = { download: h.download, phase: h.phase, downloaded: h.downloaded };
      h.completeDownload();
      return { mid, done: { download: h.download, phase: h.phase, downloaded: h.downloaded } };
    });
    expect(dl.mid.download).toBeGreaterThan(0.4);
    expect(dl.mid.download).toBeLessThan(1);
    expect(dl.done.downloaded).toBe(true);
    expect(dl.done.phase).toBe('exfil');

    const route = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceCore: CoreHandle }).__nonspaceCore;
      const before = h.trace;
      const started = h.startRouteOut();
      const scrubbed = h.trace;
      h.advance(h.layerCount > 0 ? 30 / h.layerCount : 7.5);
      return {
        started,
        before,
        scrubbed,
        frozen: h.frozenLayers,
        progress: h.freezeProgress,
        phase: h.phase,
      };
    });
    expect(route.started).toBe(true);
    expect(route.scrubbed).toBeCloseTo(route.before * 0.7, 0);
    expect(route.frozen).toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
  });
});
