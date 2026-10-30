import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SHOT_CONSTRUCT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-6-construct.png',
);
const SHOT_BERNE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-6-berne.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface ConstructHandle {
  missionId: string;
  status: string;
  mode: string;
  checkpoint: string | null;
  phase: string;
  knot: string | null;
  ended: boolean;
  won: boolean;
  onboarded: boolean;
  scars: number;
  scriptedFlatline: boolean;
  hijackText: string;
  dixieLine: string;
  tendrilPhase: string;
  engaged: boolean;
  downloaded: boolean;
  skipJackIn(): void;
  skipOnboarding(): void;
  choose(n: number): boolean;
  jumpToHosaka(): boolean;
  jumpToBerne(): boolean;
  completeJump(): void;
  askDixie(): boolean;
  useMimic(): boolean;
  crack(): void;
  completeDownload(): void;
  leaveCore(): void;
  triggerTendril(): void;
  completeTendril(): void;
  skipOverlay(): void;
  jackOut(): void;
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

const mission = (): ConstructHandle | undefined =>
  (window as unknown as { __nonspaceMission?: ConstructHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: ConstructHandle }).__nonspaceMission;
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

test.describe('M7.6 mission M3 The Construct', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m3 onboards Dixie, teaches H/MIMIC, Berne flatline has no scar, Wintermute hijacks', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m3&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm3');

      const boot = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: ConstructHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.skipOnboarding();
        h.advance(0);
        return {
          missionId: h.missionId,
          onboarded: h.onboarded,
          dixieLine: h.dixieLine,
          mode: h.mode,
          scars: h.scars,
        };
      });
      expect(boot.missionId).toBe('m3');
      expect(boot.onboarded).toBe(true);
      expect(boot.dixieLine.toLowerCase()).toMatch(/laugh|died|hosaka|ice/);
      expect(boot.scars).toBe(0);

      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png0 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats0 = litStats(png0);
      expect(stats0.max).toBeGreaterThan(30);
      expect(stats0.lit).toBeGreaterThan(200);
      expect(stats0.black / stats0.n).toBeGreaterThan(0.2);
      mkdirSync(dirname(SHOT_CONSTRUCT), { recursive: true });
      writeFileSync(SHOT_CONSTRUCT, PNG.sync.write(png0, { deflateLevel: 9 }));

      const partA = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: ConstructHandle }).__nonspaceMission;
        const jumped = h.jumpToHosaka();
        h.completeJump();
        h.advance(0);
        const read = h.askDixie();
        h.advance(4.2);
        const mimic = h.useMimic();
        h.crack();
        h.advance(0);
        h.completeDownload();
        h.advance(0);
        h.leaveCore();
        h.advance(0);
        return {
          jumped,
          read,
          mimic,
          downloaded: h.downloaded,
          dixieLine: h.dixieLine,
          mode: h.mode,
        };
      });
      expect(partA.jumped).toBe(true);
      expect(partA.read).toBe(true);
      expect(partA.mimic).toBe(true);
      expect(partA.downloaded).toBe(true);

      const arrived = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: ConstructHandle }).__nonspaceMission;
        const jumped = h.jumpToBerne();
        h.completeJump();
        h.advance(0);
        h.triggerTendril();
        h.advance(1.6);
        return { jumped, tendril: h.tendrilPhase, mode: h.mode };
      });
      expect(arrived.jumped).toBe(true);
      expect(['circle', 'sphere', 'chase']).toContain(arrived.tendril);

      await paint(page);
      const png1 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats1 = litStats(png1);
      expect(stats1.max).toBeGreaterThan(30);
      expect(stats1.lit).toBeGreaterThan(80);
      mkdirSync(dirname(SHOT_BERNE), { recursive: true });
      writeFileSync(SHOT_BERNE, PNG.sync.write(png1, { deflateLevel: 9 }));

      const partB = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: ConstructHandle }).__nonspaceMission;
        h.completeTendril();
        h.advance(0);
        const during = { mode: h.mode, scripted: h.scriptedFlatline, scars: h.scars };
        h.skipOverlay();
        h.advance(0.5);
        return {
          during,
          mode: h.mode,
          scars: h.scars,
          hijackText: h.hijackText,
          dixieLine: h.dixieLine,
          scripted: h.scriptedFlatline,
        };
      });
      expect(partB.during.mode).toBe('flatline');
      expect(partB.during.scripted).toBe(true);
      expect(partB.during.scars).toBe(0);
      expect(partB.scars).toBe(0);
      expect(partB.hijackText).toMatch(/WAIT/);
      expect(partB.scripted).toBe(true);
      expect(partB.mode).not.toBe('flatline');

      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: ConstructHandle }).__nonspaceMission;
        h.jackOut();
        h.advance(0);
        h.skipOverlay();
        h.advance(0);
        h.choose(1);
        h.advance(0);
        return { won: h.won, ended: h.ended, status: h.status, scars: h.scars, knot: h.knot };
      });
      expect(end.scars).toBe(0);
      expect(end.won || end.status === 'won').toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
