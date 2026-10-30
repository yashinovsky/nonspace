import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KUANG_SHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-8-kuang.png',
);
const DIVE_SHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-8-dive.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface KuangHandle {
  scene: string;
  mimic: number;
  reveal: number;
  lane: number;
  lanes: number;
  z: number;
  speed: number;
  phase: string;
  segment: number;
  hits: number;
  meter: number;
  m: number;
  knobs: { R: number; Phi: number };
  musicState: string;
  lastSfx: string | null;
  tolRatio: number;
  setScene(scene: string): void;
  setTime(t: number): void;
  setMimic(v: number): void;
  setLane(lane: number): void;
  stepLane(dir: number): void;
  enterGate(): void;
  crackGate(): void;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  dispose(): void;
}

const kuang = (): KuangHandle | undefined =>
  (window as unknown as { __nonspaceKuang?: KuangHandle }).__nonspaceKuang;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceKuang?: KuangHandle }).__nonspaceKuang;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
  });
}

/** Release the WebGL context so sibling SwiftShader workers (sector hitchesOver4ms / grid graze) are not starved. */
async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
      app?.dispose();
    });
  } catch {
    // Page may already be closing.
  }
  try {
    await page.goto('about:blank');
  } catch {
    // ignore
  }
}

function snapStats(png: PNG): {
  lit: number;
  maxC: number;
  magenta: number;
  cyan: number;
  gold: number;
} {
  let lit = 0;
  let maxC = 0;
  let magenta = 0;
  let cyan = 0;
  let gold = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > maxC) maxC = m;
    if (m > 18) lit++;
    const min = Math.min(r, g, b);
    if (m - min <= 18) continue;
    if (r > g + 8 && b > g + 8) magenta++;
    if (b > r + 8 && b > g + 8) cyan++;
    if (r > b + 8 && g > b + 8) gold++;
  }
  return { lit, maxC, magenta, cyan, gold };
}

test.describe('M7.8 Kuang and the dive', () => {
  // One WebGL context at a time. Live rAF / leftover tube geometry starves
  // sibling SwiftShader `grid.spec` graze / `sector.spec` hitchesOver4ms.
  test.describe.configure({ mode: 'serial' });

  test('deploy: iridescent ribs, freeze before snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?lab=kuang&scene=deploy&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      // Freeze immediately after the first frame — no live warmup.
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-lab', 'kuang');
      await expect(page.getByTestId('kuang-lab')).toBeVisible();
      await page.waitForFunction(kuang);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceKuang: KuangHandle }).__nonspaceKuang;
        h.setMimic(0);
        h.setTime(0);
      });
      await page.locator('[data-testid="kuang-lab"]').evaluate((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
      });
      await paint(page);

      const canvas = page.locator('#app > canvas');
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      mkdirSync(dirname(KUANG_SHOT), { recursive: true });
      writeFileSync(KUANG_SHOT, PNG.sync.write(png, { deflateLevel: 9 }));
      expect(png.width).toBeGreaterThan(600);
      const stats = snapStats(png);
      expect(stats.maxC).toBeGreaterThan(30);
      expect(stats.lit).toBeGreaterThan(200);
      // Thin-film spectrum (magenta / cyan / gold) — not the 8-hue beam palette.
      expect(stats.cyan + stats.gold + stats.magenta).toBeGreaterThan(80);

      const row = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceKuang: KuangHandle }).__nonspaceKuang;
        return { mimic: h.mimic, sfx: h.lastSfx, tol: h.tolRatio };
      });
      expect(row.mimic).toBeCloseTo(0, 2);
      expect(row.sfx).toBe('kuang');
      expect(row.tol).toBeGreaterThan(0.1);
      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('dive: constant speed, crisp lanes, gate Phase Lock; freeze before snapshot', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?lab=kuang&scene=dive&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-lab', 'kuang');
      await page.waitForFunction(kuang);

      const motion = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceKuang: KuangHandle }).__nonspaceKuang;
        const z0 = h.z;
        const lane0 = h.lane;
        h.advance(1);
        const z1 = h.z;
        h.stepLane(1);
        return {
          z0,
          z1,
          speed: h.speed,
          lane0,
          lane1: h.lane,
          lanes: h.lanes,
          music: h.musicState,
        };
      });
      expect(motion.speed).toBeGreaterThan(0);
      expect(motion.z1).toBeCloseTo(motion.z0 - motion.speed, 1);
      expect(motion.lane1).not.toBe(motion.lane0);
      expect(motion.lanes).toBeGreaterThanOrEqual(8);
      expect(motion.lanes).toBeLessThanOrEqual(16);
      expect(motion.music).toBe('kuangDive');

      await page.locator('[data-testid="kuang-lab"]').evaluate((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
      });
      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats = snapStats(png);
      expect(stats.maxC).toBeGreaterThan(30);
      expect(stats.lit).toBeGreaterThan(200);
      mkdirSync(dirname(DIVE_SHOT), { recursive: true });
      writeFileSync(DIVE_SHOT, PNG.sync.write(png, { deflateLevel: 9 }));

      const gate = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceKuang: KuangHandle }).__nonspaceKuang;
        h.enterGate();
        const phase = h.phase;
        const R0 = h.knobs.R;
        h.advance(0.25);
        h.crackGate();
        return { phase, R0, after: h.phase, segment: h.segment, meter0: h.meter };
      });
      expect(gate.phase).toBe('gate');
      expect(gate.after).toBe('flight');
      expect(gate.segment).toBe(1);

      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
