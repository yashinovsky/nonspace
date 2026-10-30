import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SHOT_BEACH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-10-beach.png',
);
const SHOT_STAY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-10-ending-b.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface BeachHandle {
  missionId: string;
  status: string;
  mode: string;
  phase: string;
  knot: string | null;
  ended: boolean;
  won: boolean;
  ending: 'leave' | 'stay' | null;
  reveal: number;
  bassDistance: number;
  halfRes: { w: number; h: number };
  skipBrief(): void;
  followBass(): { from: number; to: number; left: boolean };
  walkOut(): void;
  stay(): void;
  sitThroughSunset(): void;
  lookDown(): void;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    postMode: string;
    internalWidth: number;
    internalHeight: number;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  save: { data: { campaign: { flags: Record<string, boolean> } } };
  dispose(): void;
}

const mission = (): BeachHandle | undefined =>
  (window as unknown as { __nonspaceMission?: BeachHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: BeachHandle }).__nonspaceMission;
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

function litStats(png: PNG): { max: number; lit: number; warm: number; n: number } {
  let max = 0;
  let lit = 0;
  let warm = 0;
  const n = png.data.length / 4;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > max) max = m;
    if (m > 20) lit++;
    if (r > b + 8 && r > 40) warm++;
  }
  return { max, lit, warm, n };
}

async function bootM6(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?mission=m6&checkpoint=shore&quality=medium');
  await page.waitForFunction(mission, { timeout: 20_000 });
  await freezeLoop(page);
  await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm6');
}

test.describe('M7.10 mission M6 The Beach', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m6 brief WALK enters the construct', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m6&quality=medium');
      await page.waitForFunction(mission, { timeout: 20_000 });
      await freezeLoop(page);
      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        h.advance(0);
        return { mode: h.mode, knot: h.knot, missionId: h.missionId };
      });
      expect(opening.missionId).toBe('m6');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('brief');
      const after = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        h.skipBrief();
        h.advance(0);
        return { mode: h.mode, phase: h.phase };
      });
      expect(after.mode).toBe('beach');
      expect(after.phase).toBe('walk');
      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('?mission=m6 walk-out follows the bass and leaves toward M7', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await bootM6(page);

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        h.advance(0);
        return { missionId: h.missionId, mode: h.mode, phase: h.phase };
      });
      expect(opening.missionId).toBe('m6');
      expect(opening.mode).toBe('beach');
      expect(opening.phase).toBe('walk');

      await paint(page);
      const png0 = PNG.sync.read(await page.screenshot({ animations: 'disabled', type: 'png' }));
      const stats0 = litStats(png0);
      expect(stats0.max).toBeGreaterThan(40);
      expect(stats0.lit).toBeGreaterThan(400);
      mkdirSync(dirname(SHOT_BEACH), { recursive: true });
      writeFileSync(SHOT_BEACH, PNG.sync.write(png0, { deflateLevel: 9 }));

      const look = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        h.lookDown();
        h.advance(0);
        return {
          reveal: h.reveal,
          postMode: a.renderer.postMode,
          half: h.halfRes,
          internalW: a.renderer.internalWidth,
          mode: h.mode,
        };
      });
      expect(look.mode).toBe('beach');
      expect(look.postMode).toBe('beach');
      expect(look.reveal).toBeGreaterThan(0.4);
      expect(look.half.w).toBe(Math.ceil(look.internalW / 2));

      const walk = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        const followed = h.followBass();
        h.advance(0);
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          ...followed,
          phase: h.phase,
          won: h.won,
          ending: h.ending,
          leftFlag: a.save.data.campaign.flags.beachLeft === true,
        };
      });
      expect(walk.to).toBeLessThan(walk.from);
      expect(walk.left || walk.phase === 'left').toBe(true);
      expect(walk.ending).toBe('leave');
      expect(walk.won).toBe(true);
      expect(walk.leftFlag).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('?mission=m6 stay sits through a sunset into Ending B', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await bootM6(page);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        h.sitThroughSunset();
        h.advance(0);
      });

      await paint(page);
      await expect(page.getByTestId('beach-credits')).toBeVisible();
      const png1 = PNG.sync.read(await page.screenshot({ animations: 'disabled', type: 'png' }));
      const stats1 = litStats(png1);
      expect(stats1.max).toBeGreaterThan(30);
      mkdirSync(dirname(SHOT_STAY), { recursive: true });
      writeFileSync(SHOT_STAY, PNG.sync.write(png1, { deflateLevel: 9 }));

      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          phase: h.phase,
          won: h.won,
          ending: h.ending,
          endingB: a.save.data.campaign.flags.endingB === true,
        };
      });
      expect(end.phase).toBe('endingB');
      expect(end.ending).toBe('stay');
      expect(end.won).toBe(true);
      expect(end.endingB).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
