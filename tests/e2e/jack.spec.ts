import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-7-jack-in.png',
);
const SCREENSHOT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-7-jack-out.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface JackHandle {
  scene: string;
  variant: string;
  time: number;
  duration: number;
  phase: string;
  skippable: boolean;
  seen: boolean;
  done: boolean;
  collapse: { scaleX: number; scaleY: number; glow: number; fade: number };
  seek(time: number): void;
  playIn(variant?: string): void;
  playOut(): void;
  sampleAt(time: number): { luma: number; phase: string };
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  save: { data: { campaign: { flags: Record<string, boolean> } } };
}

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.endFrame(1 / 60, null);
  });
}

function meanLuma(png: PNG): number {
  const { data } = png;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    n++;
  }
  return n === 0 ? 0 : sum / n / 255;
}

function countFlashes(samples: readonly number[], threshold: number): number {
  let flashes = 0;
  let above = false;
  for (const s of samples) {
    if (!above && s >= threshold) {
      above = true;
      flashes += 1;
    } else if (above && s < threshold) {
      above = false;
    }
  }
  return flashes;
}

test.describe('M2.7 jack-in / jack-out', () => {
  test('?lab=jack plays full 5.5 s and short 1.2 s; skippable after first viewing', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=jack&seq=full&first=1&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'jack');
    await expect(page.getByTestId('jack-lab')).toBeVisible();
    await page.waitForFunction(
      () => !!(window as unknown as { __nonspaceJack?: unknown }).__nonspaceJack,
    );

    const meta = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      return { duration: h.duration, variant: h.variant, skippable: h.skippable, seen: h.seen };
    });
    expect(meta.duration).toBe(5.5);
    expect(meta.variant).toBe('full');
    expect(meta.skippable).toBe(false);

    await freezeLoop(page);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack.seek(2.2);
    });
    await drawOnce(page);
    await page.locator('[data-testid="jack-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    let maxC = 0;
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 12) lit++;
    }
    expect(maxC).toBeGreaterThan(12);
    expect(lit).toBeGreaterThan(40);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    await page.evaluate(() => {
      (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack.seek(5.5);
    });
    const after = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
      return {
        done: h.done,
        seen: h.seen,
        flag: a.save.data.campaign.flags.jackInSeen === true,
        phase: h.phase,
      };
    });
    expect(after.done).toBe(true);
    expect(after.seen).toBe(true);
    expect(after.flag).toBe(true);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack.playIn('short');
    });
    const short = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      return { duration: h.duration, skippable: h.skippable, variant: h.variant };
    });
    expect(short.duration).toBe(1.2);
    expect(short.variant).toBe('short');
    expect(short.skippable).toBe(true);

    await page.keyboard.press('Space');
    const skipped = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      return { done: h.done, time: h.time };
    });
    expect(skipped.done).toBe(true);
    expect(skipped.time).toBeCloseTo(1.2, 1);

    expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
  });

  test('steps frames for the flash rule and jack-out collapse in 0.6 s', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=jack&seq=full&first=1&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(
      () => !!(window as unknown as { __nonspaceJack?: unknown }).__nonspaceJack,
    );
    await freezeLoop(page);
    await page.locator('[data-testid="jack-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });

    // CPU twin at 12 Hz via sampleAt — do not 67× readPixels a 1280×720
    // SwiftShader backbuffer (that starves the sibling sector hitch budget).
    const lumas = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      const fps = 12;
      const duration = h.duration;
      const n = Math.round(duration * fps);
      const out: number[] = [];
      for (let i = 0; i <= n; i++) {
        out.push(h.sampleAt(i === n ? duration : i / fps).luma);
      }
      return { out, duration };
    });
    expect(lumas.out.length).toBeGreaterThan(10);
    expect(Math.max(...lumas.out)).toBeLessThan(0.45);
    expect(countFlashes(lumas.out, 0.12)).toBeLessThanOrEqual(3);
    expect(countFlashes(lumas.out, 0.1) / lumas.duration).toBeLessThanOrEqual(3);

    const gpuPhases = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
      const times = [0.4, 1.8, 4.0];
      const out: { t: number; phase: string; luma: number }[] = [];
      for (const t of times) {
        h.seek(t);
        a.renderer.endFrame(1 / 60, null);
        const s = h.sampleAt(t);
        out.push({ t, phase: s.phase, luma: s.luma });
      }
      return out;
    });
    expect(gpuPhases[0]?.phase).toBe('phosphenes');
    expect(gpuPhases[1]?.phase).toBe('origami');
    expect(gpuPhases[2]?.phase).toBe('landmarks');
    expect(Math.max(...gpuPhases.map((p) => p.luma))).toBeLessThan(0.45);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack.playOut();
    });
    const collapseMeta = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      return { duration: h.duration, scene: h.scene };
    });
    expect(collapseMeta.duration).toBe(0.6);
    expect(collapseMeta.scene).toBe('out');

    await page.evaluate(() => {
      (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack.seek(0.3);
    });
    await drawOnce(page);
    const linePng = PNG.sync.read(
      await page.locator('#app > canvas').screenshot({ animations: 'allow' }),
    );
    expect(meanLuma(linePng)).toBeGreaterThan(0);
    mkdirSync(dirname(SCREENSHOT_OUT), { recursive: true });
    writeFileSync(SCREENSHOT_OUT, PNG.sync.write(linePng));

    const collapse = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceJack: JackHandle }).__nonspaceJack;
      h.seek(0.6);
      return h.collapse;
    });
    expect(collapse.fade).toBe(0);

    expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
  });
});
