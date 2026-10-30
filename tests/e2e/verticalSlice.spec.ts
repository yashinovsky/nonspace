import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT_P0 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-4-p0.png',
);
const SCREENSHOT_M1 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-4-m1.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface SliceHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: string;
  knot: string | null;
  ended: boolean;
  won: boolean;
  scanned: boolean;
  looked: boolean;
  engaged: boolean;
  downloaded: boolean;
  coords: string;
  skipJackIn(): void;
  skipLook(): void;
  choose(n: number): boolean;
  scan(): void;
  jumpToChiba(): boolean;
  completeJump(): void;
  crack(): void;
  completeDownload(): void;
  jackOut(): void;
  skipOverlay(): void;
  forceFlatline(): void;
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

const slice = (): SliceHandle | undefined =>
  (window as unknown as { __nonspaceMission?: SliceHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: SliceHandle }).__nonspaceMission;
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

function litStats(png: PNG): { max: number; lit: number; black: number; n: number } {
  let max = 0;
  let lit = 0;
  let black = 0;
  const n = png.data.length / 4;
  for (let i = 0; i < png.data.length; i += 4) {
    const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    if (m > max) max = m;
    if (m > 16) lit++;
    if (m < 18) black++;
  }
  return { max, lit, black, n };
}

test.describe('M7.4 vertical slice P0 + M1', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=p0 plays Night City teletext then chains to M1', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=p0&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'p0');
      await page.waitForFunction(slice);
      await freezeLoop(page);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.advance(0);
      });
      await paint(page);

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        return { missionId: h.missionId, mode: h.mode, knot: h.knot };
      });
      expect(opening.missionId).toBe('p0');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('start');

      const canvas = page.locator('#app > canvas');
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats = litStats(png);
      expect(stats.max).toBeGreaterThan(30);
      expect(stats.lit).toBeGreaterThan(200);
      mkdirSync(dirname(SCREENSHOT_P0), { recursive: true });
      writeFileSync(SCREENSHOT_P0, PNG.sync.write(png, { deflateLevel: 9 }));

      const knots: string[] = [];
      for (let i = 0; i < 5; i++) {
        const next = await page.evaluate(() => {
          const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
          h.choose(1);
          h.advance(0);
          return h.knot;
        });
        knots.push(next ?? '');
      }
      expect(knots).toEqual(['night', 'linda', 'molly', 'armitage', 'surgery']);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.choose(1);
      });
      await page.waitForFunction(() => {
        const h = (window as unknown as { __nonspaceMission?: SliceHandle }).__nonspaceMission;
        return h?.missionId === 'm1';
      });
      const chained = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        return { missionId: h.missionId, mode: h.mode };
      });
      expect(chained.missionId).toBe('m1');
      expect(chained.mode).toBe('jackIn');
      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('?mission=m1 scripts look-scan-jump-crack-download-out', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m1&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm1');
      await page.waitForFunction(slice);
      await freezeLoop(page);

      const afterJack = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        return { mode: h.mode, checkpoint: h.checkpoint, looked: h.looked, phase: h.phase };
      });
      expect(afterJack.mode).toBe('matrix');
      expect(afterJack.checkpoint).toBe('start');
      expect(afterJack.looked).toBe(false);
      expect(afterJack.phase).toBe('look');

      const afterLook = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.skipLook();
        h.advance(0);
        return { looked: h.looked, checkpoint: h.checkpoint, phase: h.phase };
      });
      expect(afterLook.looked).toBe(true);
      expect(afterLook.checkpoint).toBe('look');
      expect(afterLook.phase).toBe('scan');

      const boot = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.scan();
        h.advance(0);
        const jumped = h.jumpToChiba();
        h.completeJump();
        h.advance(0);
        return {
          jumped,
          scanned: h.scanned,
          mode: h.mode,
          phase: h.phase,
          checkpoint: h.checkpoint,
          coords: h.coords,
        };
      });
      expect(boot.jumped).toBe(true);
      expect(boot.scanned).toBe(true);
      expect(boot.mode).toBe('matrix');
      expect(['approach', 'jump']).toContain(boot.phase);
      expect(boot.checkpoint).toBe('chiba');
      expect(boot.coords.startsWith('CHBA')).toBe(true);

      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats = litStats(png);
      expect(stats.max).toBeGreaterThan(30);
      expect(stats.lit).toBeGreaterThan(200);
      expect(stats.black / stats.n).toBeGreaterThan(0.25);
      mkdirSync(dirname(SCREENSHOT_M1), { recursive: true });
      writeFileSync(SCREENSHOT_M1, PNG.sync.write(png, { deflateLevel: 9 }));

      const run = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.crack();
        h.advance(0);
        const afterCrack = {
          mode: h.mode,
          engaged: h.engaged,
          downloaded: h.downloaded,
          checkpoint: h.checkpoint,
        };
        h.completeDownload();
        h.advance(0);
        const afterTake = { mode: h.mode, downloaded: h.downloaded, checkpoint: h.checkpoint };
        h.jackOut();
        h.advance(0);
        const outMode = h.mode;
        h.skipOverlay();
        h.advance(0);
        const debrief = { mode: h.mode, knot: h.knot };
        h.choose(1);
        h.advance(0);
        return {
          afterCrack,
          afterTake,
          outMode,
          debrief,
          won: h.won,
          ended: h.ended,
          status: h.status,
        };
      });
      expect(run.afterCrack.mode).toBe('core');
      expect(run.afterCrack.checkpoint).toBe('core');
      expect(run.afterTake.downloaded).toBe(true);
      expect(run.afterTake.checkpoint).toBe('take');
      expect(run.outMode).toBe('jackOut');
      expect(run.debrief.mode).toBe('interlude');
      expect(run.debrief.knot).toBe('debrief');
      expect(run.won || run.status === 'won').toBe(true);
      expect(run.ended).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('?checkpoint=chiba then flatline retries; look checkpoint seeks', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m1&checkpoint=chiba&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.waitForFunction(slice);
      await freezeLoop(page);

      const chiba = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.advance(0);
        return { mode: h.mode, checkpoint: h.checkpoint, coords: h.coords };
      });
      expect(chiba.mode).toBe('matrix');
      expect(chiba.checkpoint).toBe('chiba');
      expect(chiba.coords.startsWith('CHBA')).toBe(true);

      const flat = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.forceFlatline();
        h.advance(0);
        const during = h.mode;
        h.skipOverlay();
        h.advance(0);
        return { during, after: h.mode };
      });
      expect(flat.during).toBe('flatline');
      expect(flat.after).toBe('matrix');

      await page.goto('/?mission=m1&checkpoint=look&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.waitForFunction(slice);
      await freezeLoop(page);
      const look = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: SliceHandle }).__nonspaceMission;
        h.advance(0);
        return { checkpoint: h.checkpoint, mode: h.mode, phase: h.phase, looked: h.looked };
      });
      expect(look.checkpoint).toBe('look');
      expect(look.looked).toBe(true);
      expect(['jackIn', 'matrix']).toContain(look.mode);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
