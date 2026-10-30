import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-5-sensenet-mission.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface SenseHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  knot: string | null;
  ended: boolean;
  won: boolean;
  failed: boolean;
  caught: boolean;
  panic: boolean;
  gates: string;
  meatTime: number;
  clock: string;
  rekeyEvery: [number, number] | null;
  flipped: boolean;
  exposure: number;
  skipJackIn(): void;
  choose(n: number): boolean;
  jumpToSenseNet(): boolean;
  completeJump(): void;
  crack(): void;
  crackGate(id: string): void;
  flip(on?: boolean): void;
  seekMeat(t: number): void;
  jackOut(): void;
  skipOverlay(): void;
  forceFlatline(): void;
  forceMollyCaught(): void;
  retry(): void;
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

const mission = (): SenseHandle | undefined =>
  (window as unknown as { __nonspaceMission?: SenseHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: SenseHandle }).__nonspaceMission;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
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

function litStats(png: PNG): { max: number; lit: number; warm: number } {
  let max = 0;
  let lit = 0;
  let warm = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > max) max = m;
    if (m > 16) lit++;
    if (r > 40 && r >= g && g > b + 4) warm++;
  }
  return { max, lit, warm };
}

test.describe('M7.5 mission M2 Sense/Net', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m2 plays three gates, panic halves re-key, and wins', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    try {
      await page.goto('/?mission=m2&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm2');
      await page.waitForFunction(mission);
      await freezeLoop(page);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        h.advance(0);
      });
      await paint(page);

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        return { missionId: h.missionId, mode: h.mode, knot: h.knot };
      });
      expect(opening.missionId).toBe('m2');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('brief');

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.completeJump();
        h.advance(0);
        const before = h.rekeyEvery ? h.rekeyEvery[0] : 0;
        h.seekMeat(80);
        h.crack();
        h.advance(0);
        h.flip(true);
        h.paint();
        return before;
      });
      await paint(page);

      const canvas = page.locator('#app > canvas');
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats = litStats(png);
      expect(stats.max).toBeGreaterThan(30);
      expect(stats.lit).toBeGreaterThan(200);
      mkdirSync(dirname(SCREENSHOT), { recursive: true });
      writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

      const run = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        h.flip(false);
        h.advance(0);
        const lobby = { gates: h.gates, meat: h.meatTime, clock: h.clock };
        h.seekMeat(200);
        h.crack();
        h.advance(0);
        const rekeyBefore = h.rekeyEvery ? h.rekeyEvery[0] : 0;
        h.seekMeat(240);
        h.advance(0);
        const panic = {
          panic: h.panic,
          clock: h.clock,
          rekey: h.rekeyEvery ? h.rekeyEvery[0] : 0,
          rekeyBefore,
        };
        h.seekMeat(280);
        h.crack();
        h.advance(0);
        const vault = { gates: h.gates, checkpoint: h.checkpoint };
        h.jackOut();
        h.advance(0);
        h.skipOverlay();
        h.advance(0);
        return {
          lobby,
          panic,
          vault,
          mode: h.mode,
          knot: h.knot,
          won: h.won,
          status: h.status,
          ended: h.ended,
        };
      });

      expect(run.lobby.gates.split(',')[0]).toBe('hit');
      expect(run.panic.panic).toBe(true);
      expect(run.panic.clock).toMatch(/^00:04:/);
      expect(run.panic.rekey).toBeGreaterThan(run.panic.rekeyBefore);
      expect(run.panic.rekey).toBeCloseTo(run.panic.rekeyBefore * 2, 5);
      expect(run.vault.gates).toBe('hit,hit,hit');
      expect(run.mode).toBe('interlude');
      expect(run.knot).toBe('debrief');
      expect(run.won || run.status === 'won').toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('Molly caught and flatline retry from checkpoint', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    try {
      await page.goto('/?mission=m2&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.waitForFunction(mission);
      await freezeLoop(page);

      const caught = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.forceMollyCaught();
        h.advance(0);
        const during = { mode: h.mode, caught: h.caught, knot: h.knot };
        h.choose(1);
        h.advance(0);
        return { during, after: h.mode, caught: h.caught };
      });
      expect(caught.during.mode).toBe('interlude');
      expect(caught.during.caught).toBe(true);
      expect(caught.during.knot).toBe('caught');
      expect(caught.after).toBe('matrix');
      expect(caught.caught).toBe(false);

      await page.goto('/?mission=m2&checkpoint=approach&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.waitForFunction(mission);
      await freezeLoop(page);

      const flat = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SenseHandle }).__nonspaceMission;
        h.advance(0);
        h.skipJackIn();
        h.advance(0);
        h.forceFlatline();
        h.advance(0);
        const during = h.mode;
        h.skipOverlay();
        h.advance(0);
        return { during, after: h.mode, checkpoint: h.checkpoint };
      });
      expect(flat.during).toBe('flatline');
      expect(flat.after).toBe('matrix');

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
