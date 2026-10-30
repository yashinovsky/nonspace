import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SHOT_ISTANBUL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-7-istanbul.png',
);
const SHOT_TURING = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-7-turing.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface TuringHandle {
  missionId: string;
  status: string;
  mode: string;
  phase: string;
  knot: string | null;
  pageTitle: string;
  ringing: boolean;
  ended: boolean;
  won: boolean;
  heat: number;
  watcherCount: number;
  exposed: boolean;
  decoyRemaining: number;
  breaches: number;
  wiped: boolean;
  skipBrief(): void;
  skipJackIn(): void;
  choose(n: number): boolean;
  dropDecoy(): boolean;
  flyCorridor(): void;
  crack(): void;
  completeWipe(): void;
  jackOut(): void;
  skipOverlay(): void;
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

const mission = (): TuringHandle | undefined =>
  (window as unknown as { __nonspaceMission?: TuringHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: TuringHandle }).__nonspaceMission;
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

test.describe('M7.7 mission M4 Turing', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m4 plays Act III interludes, DECOY corridor, wipe with ≤ 2 breaches', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m4&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm4');

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.advance(0);
        return { missionId: h.missionId, mode: h.mode, knot: h.knot, title: h.pageTitle };
      });
      expect(opening.missionId).toBe('m4');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('brief');

      const istanbul = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.choose(1);
        h.advance(0.05);
        return { knot: h.knot, title: h.pageTitle, ringing: h.ringing, mode: h.mode };
      });
      expect(istanbul.knot).toBe('istanbul');
      expect(istanbul.title).toMatch(/ISTANBUL/i);
      expect(istanbul.mode).toBe('interlude');

      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png0 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats0 = litStats(png0);
      expect(stats0.max).toBeGreaterThan(20);
      mkdirSync(dirname(SHOT_ISTANBUL), { recursive: true });
      writeFileSync(SHOT_ISTANBUL, PNG.sync.write(png0, { deflateLevel: 9 }));

      const freeside = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.choose(1);
        h.advance(0);
        return { knot: h.knot, title: h.pageTitle };
      });
      expect(freeside.knot).toBe('freeside');
      expect(freeside.title).toMatch(/FREESIDE/i);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.dropDecoy();
        h.advance(0);
      });

      await paint(page);
      const png1 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats1 = litStats(png1);
      expect(stats1.max).toBeGreaterThan(30);
      expect(stats1.lit).toBeGreaterThan(80);
      expect(stats1.black / stats1.n).toBeGreaterThan(0.15);
      mkdirSync(dirname(SHOT_TURING), { recursive: true });
      writeFileSync(SHOT_TURING, PNG.sync.write(png1, { deflateLevel: 9 }));

      const stealth = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        const decoy = h.decoyRemaining > 0;
        h.flyCorridor();
        h.advance(0);
        return {
          decoy,
          decoyRemaining: h.decoyRemaining,
          watchers: h.watcherCount,
          mode: h.mode,
          breaches: h.breaches,
        };
      });
      expect(stealth.watchers).toBeGreaterThanOrEqual(3);
      expect(stealth.breaches).toBe(0);

      const wipe = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.crack();
        h.advance(0);
        h.completeWipe();
        h.advance(0);
        return { wiped: h.wiped, breaches: h.breaches, mode: h.mode };
      });
      expect(wipe.wiped).toBe(true);
      expect(wipe.breaches).toBeLessThanOrEqual(2);

      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TuringHandle }).__nonspaceMission;
        h.jackOut();
        h.advance(0);
        h.skipOverlay();
        h.advance(0);
        h.choose(1);
        h.advance(0);
        return {
          won: h.won,
          ended: h.ended,
          status: h.status,
          breaches: h.breaches,
          knot: h.knot,
        };
      });
      expect(end.breaches).toBeLessThanOrEqual(2);
      expect(end.won || end.status === 'won' || end.ended).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
