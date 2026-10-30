import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SHOT_WORD = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-11-word.png',
);
const SHOT_MERGE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-11-merge.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface TrueNameHandle {
  missionId: string;
  status: string;
  mode: string;
  phase: string;
  checkpoint: string | null;
  knot: string | null;
  ended: boolean;
  won: boolean;
  failed: boolean;
  frozen: boolean;
  word: string;
  wordHeard: boolean;
  wordIn: boolean;
  subtitle: string;
  deckOpen: boolean;
  deckLabel: string;
  erasePrompt: boolean;
  erased: boolean | null;
  mergeT: number;
  mergePhase: string;
  ending: 'A' | 'B' | null;
  complete: boolean;
  laugh: boolean;
  skipJackIn(): void;
  playWordScene(): void;
  openDeck(): void;
  typeWord(raw: string): boolean;
  missWordWindow(): void;
  retry(): void;
  completeMerge(): void;
  seekMerge(t: number): void;
  answerErase(yes: boolean): boolean;
  skipEpilogue(): void;
  enterCoda(): void;
  skipToCredits(): void;
  advance(dt: number): void;
  paint(): void;
}

interface BeachHandle {
  missionId: string;
  phase: string;
  ending: 'leave' | 'stay' | null;
  sitThroughSunset(): void;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  save: {
    data: {
      campaign: {
        act: number;
        flags: Record<string, boolean>;
        dixieErased?: boolean;
      };
    };
  };
  dispose(): void;
}

const mission = (): TrueNameHandle | undefined =>
  (window as unknown as { __nonspaceMission?: TrueNameHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: TrueNameHandle }).__nonspaceMission;
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

test.describe('M7.11 mission M7 True Name, merge, endings', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m7 types the word, merges, erase Y, Ending A', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m7&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm7');

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.advance(0);
        return { missionId: h.missionId, mode: h.mode, knot: h.knot, phase: h.phase };
      });
      expect(opening.missionId).toBe('m7');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('brief');

      const heard = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.playWordScene();
        h.advance(0);
        return {
          word: h.word,
          heard: h.wordHeard,
          subtitle: h.subtitle,
          phase: h.phase,
          flipped: h.mode === 'simstim' || h.phase === 'simstim' || h.phase === 'word',
        };
      });
      expect(heard.word).toBe('to whom');
      expect(heard.heard).toBe(true);
      expect(heard.subtitle.toLowerCase()).toContain('to whom');

      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png0 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats0 = litStats(png0);
      expect(stats0.max).toBeGreaterThan(20);
      mkdirSync(dirname(SHOT_WORD), { recursive: true });
      writeFileSync(SHOT_WORD, PNG.sync.write(png0, { deflateLevel: 9 }));

      const typed = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.openDeck();
        h.advance(0);
        const ok = h.typeWord('to whom');
        h.advance(0);
        return {
          ok,
          wordIn: h.wordIn,
          deckLabel: h.deckLabel,
          phase: h.phase,
          mergeT: h.mergeT,
        };
      });
      expect(typed.ok).toBe(true);
      expect(typed.wordIn).toBe(true);

      const merged = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.seekMerge(220);
        h.advance(0);
        return { phase: h.phase, mergePhase: h.mergePhase, mergeT: h.mergeT };
      });
      expect(merged.mergeT).toBeGreaterThan(200);
      expect(['fold', 'reflow', 'unify', 'merge']).toContain(merged.mergePhase);

      await paint(page);
      const png1 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats1 = litStats(png1);
      expect(stats1.max).toBeGreaterThan(20);
      mkdirSync(dirname(SHOT_MERGE), { recursive: true });
      writeFileSync(SHOT_MERGE, PNG.sync.write(png1, { deflateLevel: 9 }));

      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        h.completeMerge();
        h.advance(0);
        const eraseOpen = h.erasePrompt;
        h.answerErase(true);
        h.advance(0);
        h.enterCoda();
        h.advance(0);
        const laugh = h.laugh;
        h.skipToCredits();
        h.advance(0);
        return {
          eraseOpen,
          erased: h.erased,
          laugh,
          ending: h.ending,
          complete: h.complete,
          won: h.won,
          act: a.save.data.campaign.act,
          endingA: a.save.data.campaign.flags.endingA === true,
          dixieErased: a.save.data.campaign.dixieErased === true,
        };
      });
      expect(end.eraseOpen).toBe(true);
      expect(end.erased).toBe(true);
      expect(end.laugh).toBe(true);
      expect(end.ending).toBe('A');
      expect(end.complete).toBe(true);
      expect(end.endingA).toBe(true);
      expect(end.dixieErased).toBe(true);
      expect(end.act).toBe(5);
      await expect(page.getByTestId('ending-credits')).toBeVisible();
      await expect(page.getByTestId('credits-fonts')).toContainText(/Hershey/i);
      await expect(page.getByTestId('credits-fonts')).toContainText(/Px437/i);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('word miss re-freezes ICE then retry types it', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m7&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);

      const miss = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.playWordScene();
        h.advance(0);
        h.missWordWindow();
        h.advance(0);
        return { frozen: h.frozen, failed: h.failed, wordIn: h.wordIn, phase: h.phase };
      });
      expect(miss.frozen).toBe(true);
      expect(miss.failed).toBe(true);
      expect(miss.wordIn).toBe(false);

      const again = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        h.retry();
        h.advance(0);
        const after = { frozen: h.frozen, phase: h.phase, heard: h.wordHeard };
        h.openDeck();
        const ok = h.typeWord('TO WHOM');
        h.advance(0);
        return { ...after, ok, wordIn: h.wordIn, frozen2: h.frozen };
      });
      expect(again.frozen).toBe(false);
      expect(again.heard).toBe(true);
      expect(again.ok).toBe(true);
      expect(again.wordIn).toBe(true);
      expect(again.frozen2).toBe(false);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('Dixie erase N is reflected in the epilogue', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m7&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);

      const kept = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: TrueNameHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        h.skipJackIn();
        h.advance(0);
        h.playWordScene();
        h.openDeck();
        h.typeWord('to whom');
        h.completeMerge();
        h.advance(0);
        h.answerErase(false);
        h.advance(0);
        return {
          erased: h.erased,
          knot: h.knot,
          saveErased: a.save.data.campaign.dixieErased,
          phase: h.phase,
        };
      });
      expect(kept.erased).toBe(false);
      expect(kept.saveErased).toBe(false);
      expect(kept.knot).toBe('kept');

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('Ending B still sits with Linda on the Beach path', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m6&checkpoint=shore&quality=medium');
      await page.waitForFunction(() => {
        const h = (window as unknown as { __nonspaceMission?: BeachHandle }).__nonspaceMission;
        return !!h && h.missionId === 'm6';
      });
      await freezeLoop(page);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        h.sitThroughSunset();
        h.advance(0);
      });
      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission?: BeachHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
        h?.paint();
        a?.renderer.endFrame(0, null);
      });
      await expect(page.getByTestId('beach-credits')).toBeVisible();
      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: BeachHandle }).__nonspaceMission;
        const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          phase: h.phase,
          ending: h.ending,
          endingB: a.save.data.campaign.flags.endingB === true,
        };
      });
      expect(end.phase).toBe('endingB');
      expect(end.ending).toBe('stay');
      expect(end.endingB).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
