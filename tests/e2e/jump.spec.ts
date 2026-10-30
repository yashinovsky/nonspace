import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-6-jump.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface JumpHandle {
  scene: string;
  phase: string;
  elapsed: number;
  duration: number;
  streakDuration: number;
  active: boolean;
  lastError: string | null;
  lastJump: string | null;
  destReady: boolean;
  standoff: number;
  speed: number;
  sfx: readonly string[];
  deckOpen: boolean;
  startCoord(raw: string): boolean;
  seek(time: number): void;
  tick(dt: number): void;
  setGrip(on: boolean): void;
  setCore(on: boolean): void;
  setTrace(value: number): void;
  openDeck(): void;
  closeDeck(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
  input: { sample(dt: number): unknown };
  modes: { handleInput(frame: unknown): void; update(dt: number): void };
}

const jump = (): JumpHandle | undefined =>
  (window as unknown as { __nonspaceJump?: JumpHandle }).__nonspaceJump;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function drawOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.endFrame(1 / 60, null);
  });
}

async function pump(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    const j = (window as unknown as { __nonspaceJump?: JumpHandle }).__nonspaceJump;
    const frame = app?.input.sample(0);
    if (frame) app?.modes.handleInput(frame);
    app?.modes.update(0);
    j?.tick(0);
  });
}

test.describe('M2.6 coordinate jump', () => {
  test('valid jump, invalid beep, blocks, dest ready; freeze before snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=jump');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'jump');
    await page.waitForFunction(jump);
    await freezeLoop(page);

    await expect(page.getByTestId('jump-lab')).toBeVisible();
    await expect(page.getByTestId('deck-panel')).toBeVisible();
    await expect(page.getByTestId('deck-tab-COORD')).toBeVisible();

    await page.keyboard.type('not a coord');
    await page.keyboard.press('Enter');
    await pump(page);
    const bad = await page.evaluate(() => {
      const j = (window as unknown as { __nonspaceJump: JumpHandle }).__nonspaceJump;
      return { err: j.lastError, sfx: j.sfx.slice() };
    });
    expect(bad.err).toBe('BAD COORD');
    expect(bad.sfx).toContain('deckError');

    await page.evaluate(() => {
      const j = (window as unknown as { __nonspaceJump: JumpHandle }).__nonspaceJump;
      j.closeDeck();
      j.setGrip(true);
      const blocked = j.startCoord('CHBA 0412.90 / 0180.20 / 0160');
      j.setGrip(false);
      j.setCore(true);
      const core = j.startCoord('CHBA 0412.90 / 0180.20 / 0160');
      j.setCore(false);
      j.setTrace(100);
      const burned = j.startCoord('CHBA 0412.90 / 0180.20 / 0160');
      j.setTrace(0);
      (window as unknown as { __jumpBlocks?: unknown }).__jumpBlocks = {
        blocked,
        core,
        burned,
        sfx: j.sfx.slice(),
      };
    });
    const blocks = await page.evaluate(() => {
      return (
        window as unknown as { __jumpBlocks: { blocked: boolean; core: boolean; burned: boolean } }
      ).__jumpBlocks;
    });
    expect(blocks.blocked).toBe(false);
    expect(blocks.core).toBe(false);
    expect(blocks.burned).toBe(false);

    const landed = await page.evaluate(async () => {
      const j = (window as unknown as { __nonspaceJump: JumpHandle }).__nonspaceJump;
      const ok = j.startCoord('CHBA 0412.90 / 0180.20 / 0160');
      const streak = j.streakDuration;
      const total = j.duration;
      const dt = 1 / 60;
      const steps = Math.ceil(total / dt) + 2;
      for (let i = 0; i < steps; i++) {
        j.tick(dt);
        if (i % 4 === 0) await Promise.resolve();
      }
      return {
        ok,
        streak,
        total,
        phase: j.phase,
        speed: j.speed,
        standoff: j.standoff,
        destReady: j.destReady,
        sfx: j.sfx.slice(),
        deckOpen: j.deckOpen,
      };
    });
    expect(landed.ok).toBe(true);
    expect(landed.streak).toBeGreaterThanOrEqual(1.5);
    expect(landed.streak).toBeLessThanOrEqual(3);
    expect(landed.phase).toBe('done');
    expect(landed.speed).toBeCloseTo(0, 3);
    expect(landed.standoff).toBeGreaterThan(290);
    expect(landed.standoff).toBeLessThan(310);
    expect(landed.destReady).toBe(true);
    expect(landed.sfx).toContain('jump');
    expect(landed.sfx).toContain('jumpArrive');
    expect(landed.deckOpen).toBe(false);

    await page.evaluate(() => {
      const j = (window as unknown as { __nonspaceJump: JumpHandle }).__nonspaceJump;
      if (j.phase === 'done' || j.phase === 'idle') j.startCoord('CHBA 0412.90 / 0180.20 / 0160');
      j.seek(0.4 + j.streakDuration * 0.55);
      j.tick(0);
    });
    await page.locator('[data-testid="jump-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    await freezeLoop(page);
    await drawOnce(page);
    const png = PNG.sync.read(await page.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    let lit = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 18) lit++;
    }
    expect(maxC).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(80);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    expect(errors).toEqual([]);
  });
});
