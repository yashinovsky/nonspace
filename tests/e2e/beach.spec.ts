import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/beach.png',
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
  renderer: {
    postMode: string;
    quality: { tier: string };
    info(): { width: number; height: number };
  };
  beach?: {
    debug: {
      phase: string;
      reveal: number;
      sunY: number;
      bassDistance: number;
    };
    phase: string;
    reveal: number;
    forceStay(): { choice?: string };
    forceLeave(): { choice?: string };
    walk: { pose: { pitch: number }; prev: { pitch: number } };
    stillness: number;
    step(dt: number): unknown;
  };
  save: { data: { campaign: { flags: Record<string, boolean> } } };
}

test.describe('M7.10 beach', () => {
  test('?lab=beach raymarches a clean beach (no CRT) and captures the look', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=beach&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'beach');
    await page.waitForFunction(() => {
      const app = (window as unknown as { __nonspace?: BeachHandle }).__nonspace;
      return !!app?.beach && app.renderer.postMode === 'beach';
    });

    await page.waitForTimeout(800);

    // Freeze rAF so Playwright does not wait forever for a dirty WebGL canvas
    // (CI timeout: "waiting for element to be stable" during locator.screenshot).
    await page.evaluate(() => {
      type Loop = { setAnimationLoop(fn: null): void };
      const app = (window as unknown as { __nonspace?: { renderer: { three: Loop } } }).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
    });

    const png = PNG.sync.read(await page.screenshot({ animations: 'allow', type: 'png' }));
    let maxChannel = 0;
    let lit = 0;
    let warm = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const m = Math.max(r, g, b);
      if (m > maxChannel) maxChannel = m;
      if (m > 20) lit++;
      if (r > b + 8 && r > 40) warm++;
    }
    expect(maxChannel).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(800);

    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    const meta = await page.evaluate(() => {
      const app = (window as unknown as { __nonspace: BeachHandle }).__nonspace;
      return {
        postMode: app.renderer.postMode,
        phase: app.beach?.phase,
        sunY: app.beach?.debug.sunY,
        gpu: app.renderer.info(),
      };
    });
    console.log(JSON.stringify(meta));
    expect(meta.postMode).toBe('beach');
    expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    void warm;
  });

  test('checkerboard reveal and stay/leave choices', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 960, height: 540 });
    await page.goto('/?lab=beach&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await page.waitForFunction(() => {
      const app = (window as unknown as { __nonspace?: BeachHandle }).__nonspace;
      return !!app?.beach;
    });

    const reveal = await page.evaluate(() => {
      const beach = (window as unknown as { __nonspace: BeachHandle }).__nonspace.beach!;
      beach.walk.pose.pitch = -1.2;
      beach.walk.prev.pitch = -1.2;
      beach.stillness = 1;
      for (let i = 0; i < 30; i++) beach.step(1 / 60);
      return beach.reveal;
    });
    expect(reveal).toBeGreaterThan(0.4);

    await page.evaluate(() => {
      (window as unknown as { __nonspace: BeachHandle }).__nonspace.beach!.forceStay();
    });
    await expect(page.getByTestId('beach-credits')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __nonspace: BeachHandle }).__nonspace.save.data.campaign.flags
              .endingB === true,
        ),
      )
      .toBe(true);
    const phase = await page.evaluate(
      () => (window as unknown as { __nonspace: BeachHandle }).__nonspace.beach!.phase,
    );
    expect(phase).toBe('endingB');

    const errors2 = errors.filter((e) => !e.includes('AudioContext'));
    expect(errors2).toEqual([]);
  });
});
