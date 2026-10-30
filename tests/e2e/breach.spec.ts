import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-3-breach.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface BreachHandle {
  scene: string;
  engaged: boolean;
  neural: number;
  trace: number;
  gripRemaining: number;
  jackOutBlocked: boolean;
  scars: number;
  knobs: { R: number; Phi: number };
  meter: number;
  flatlinePhase: string;
  burned: boolean;
  canEngage(player: Vec3, forward: Vec3): boolean;
  tryEngage(player: Vec3, forward: Vec3): boolean;
  engage(): void;
  forceGrip(): void;
  forceFlatline(scripted?: boolean): void;
  forceBurned(): void;
  seekFlatline(time: number): void;
  stepInput(dt: number, patch?: { mouseDx?: number; mouseDy?: number; fine?: boolean }): void;
  advance(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const breach = (): BreachHandle | undefined =>
  (window as unknown as { __nonspaceBreach?: BreachHandle }).__nonspaceBreach;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceBreach?: BreachHandle }).__nonspaceBreach;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
  });
}

test.describe('M4.3 breach controller', () => {
  test('engages, knobs, grip, flatline, burned; freeze before snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=breach&scene=white&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'breach');
    await expect(page.getByTestId('breach-lab')).toBeVisible();
    await page.waitForFunction(breach);

    // Freeze before any canvas snapshot. Do not spin a live HUD + CRT rAF —
    // that hung SwiftShader teardown on sibling grid/loop/points specs.
    await freezeLoop(page);
    await paint(page);

    const rules = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceBreach: BreachHandle }).__nonspaceBreach;
      const ice = { x: 0, y: 0, z: 0 };
      const fwd = { x: 0, y: 0, z: -1 };
      return {
        at60: h.canEngage({ x: ice.x, y: ice.y, z: 60 }, fwd),
        at61: h.canEngage({ x: ice.x, y: ice.y, z: 61 }, fwd),
        lookingAway: h.canEngage({ x: 0, y: 0, z: 40 }, { x: 0, y: 0, z: 1 }),
        engaged: h.engaged,
      };
    });
    expect(rules.at60).toBe(true);
    expect(rules.at61).toBe(false);
    expect(rules.lookingAway).toBe(false);
    expect(rules.engaged).toBe(true);

    const knobs = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceBreach: BreachHandle }).__nonspaceBreach;
      const before = { ...h.knobs };
      h.stepInput(1 / 60, { mouseDx: 80, mouseDy: 30 });
      return { before, after: { ...h.knobs } };
    });
    expect(knobs.after.R).not.toBeCloseTo(knobs.before.R, 5);
    expect(knobs.after.Phi).not.toBeCloseTo(knobs.before.Phi, 5);

    await page.locator('[data-testid="breach-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    await paint(page);
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    expect(png.width).toBeGreaterThan(600);
    let lit = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 18) lit++;
    }
    expect(maxC).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(200);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    const grip = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceBreach: BreachHandle }).__nonspaceBreach;
      h.forceGrip();
      return { blocked: h.jackOutBlocked, remaining: h.gripRemaining };
    });
    expect(grip.blocked).toBe(true);
    expect(grip.remaining).toBeGreaterThan(7);
    await expect(page.locator('#app')).toHaveAttribute('data-jack-out', '0');

    const flat = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceBreach: BreachHandle }).__nonspaceBreach;
      const scars0 = h.scars;
      h.forceFlatline(false);
      h.seekFlatline(0.2);
      const beeps = h.flatlinePhase;
      h.seekFlatline(4);
      return { beeps, scars0, scars1: h.scars, phase: h.flatlinePhase };
    });
    expect(flat.beeps).toBe('beeps');
    expect(flat.scars1).toBe(flat.scars0 + 1);

    const burned = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceBreach: BreachHandle }).__nonspaceBreach;
      h.forceBurned();
      return h.burned;
    });
    expect(burned).toBe(true);

    expect(errors).toEqual([]);
  });
});
