import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const V1_FULL = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../unit/fixtures/saves/v1-full.json'),
  'utf8',
);
const V1_LEGACY = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../unit/fixtures/saves/v1-legacy.json'),
  'utf8',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface SaveHandle {
  status: string;
  data: {
    version: number;
    campaign: {
      act: number;
      missionId: string | null;
      checkpoint: string | null;
      heat: number;
      scars: number;
      flags: Record<string, boolean>;
      dixieErased?: boolean;
      softsOwned: string[];
    };
    settings: {
      reduceMotion: boolean;
      difficulty: string;
      audio: { master: number; music: number };
      graphics: { quality: string };
    };
  };
  commit(): boolean;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  save: SaveHandle;
  settings: {
    value: { audio: { music: number }; reduceMotion: boolean };
    update(patch: { audio?: { music?: number }; reduceMotion?: boolean }): void;
  };
  dispose(): void;
}

const app = (): AppHandle | undefined =>
  (window as unknown as { __nonspace?: AppHandle }).__nonspace;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.three.setAnimationLoop(null);
  });
}

async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      h?.renderer.three.setAnimationLoop(null);
      h?.dispose();
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

test.describe('save migration (localStorage campaign + settings)', () => {
  test.describe.configure({ mode: 'serial' });

  test('loads a v1 campaign+settings JSON from localStorage', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    try {
      await page.addInitScript((blob) => {
        window.localStorage.setItem('nonspace.save', blob);
      }, V1_FULL);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?debug&quality=medium');
      await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
      await page.waitForFunction(app);
      await freezeLoop(page);

      const loaded = await page.evaluate(() => {
        const h = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          status: h.save.status,
          version: h.save.data.version,
          campaign: h.save.data.campaign,
          settings: {
            reduceMotion: h.save.data.settings.reduceMotion,
            difficulty: h.save.data.settings.difficulty,
            audio: h.save.data.settings.audio,
            graphics: h.save.data.settings.graphics,
          },
        };
      });
      expect(loaded.status).toBe('loaded');
      expect(loaded.version).toBe(1);
      expect(loaded.campaign.act).toBe(5);
      expect(loaded.campaign.missionId).toBe('m7');
      expect(loaded.campaign.checkpoint).toBe('merge');
      expect(loaded.campaign.dixieErased).toBe(true);
      expect(loaded.campaign.flags.endingA).toBe(true);
      expect(loaded.campaign.softsOwned).toEqual(['probe', 'clamp', 'kuang']);
      expect(loaded.settings.reduceMotion).toBe(true);
      expect(loaded.settings.difficulty).toBe('hard');
      expect(loaded.settings.audio.music).toBeCloseTo(0.2, 5);
      expect(loaded.settings.graphics.quality).toBe('medium');

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('persists a settings patch across reload', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    try {
      await page.addInitScript((blob) => {
        if (!window.localStorage.getItem('nonspace.save')) {
          window.localStorage.setItem('nonspace.save', blob);
        }
      }, V1_FULL);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?debug&quality=medium');
      await page.waitForFunction(app);
      await freezeLoop(page);

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        h.settings.update({ audio: { music: 0.05 }, reduceMotion: false });
        h.save.commit();
      });

      await page.goto('/?debug&quality=medium');
      await page.waitForFunction(app);
      await freezeLoop(page);
      const again = await page.evaluate(() => {
        const h = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          music: h.save.data.settings.audio.music,
          reduceMotion: h.save.data.settings.reduceMotion,
          missionId: h.save.data.campaign.missionId,
          raw: window.localStorage.getItem('nonspace.save'),
        };
      });
      expect(again.music).toBeCloseTo(0.05, 5);
      expect(again.reduceMotion).toBe(false);
      expect(again.missionId).toBe('m7');
      expect(again.raw).toBeTruthy();
      expect(JSON.parse(again.raw!).version).toBe(1);
      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });

  test('repairs a legacy v1 blob field-by-field without discarding the save', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    try {
      await page.addInitScript((blob) => {
        window.localStorage.setItem('nonspace.save', blob);
      }, V1_LEGACY);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?debug&quality=medium');
      await page.waitForFunction(app);
      await freezeLoop(page);

      const repaired = await page.evaluate(() => {
        const h = (window as unknown as { __nonspace: AppHandle }).__nonspace;
        return {
          status: h.save.status,
          act: h.save.data.campaign.act,
          missionId: h.save.data.campaign.missionId,
          heat: h.save.data.campaign.heat,
          flags: h.save.data.campaign.flags,
          reduceMotion: h.save.data.settings.reduceMotion,
          quality: h.save.data.settings.graphics.quality,
          master: h.save.data.settings.audio.master,
        };
      });
      expect(repaired.status).toBe('loaded');
      expect(repaired.act).toBe(2);
      expect(repaired.missionId).toBe('m2');
      // Legacy `heat` 0–1 is accepted as-is at v1 (no production migration yet).
      expect(repaired.heat).toBeCloseTo(0.42, 5);
      expect(repaired.flags.metFinn).toBe(true);
      expect(repaired.reduceMotion).toBe(true);
      expect(repaired.quality).toBe('auto');
      expect(repaired.master).toBe(0.8);
      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
