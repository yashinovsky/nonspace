import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-2-dixie.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface DixieHandle {
  lastLine: string;
  lastLineId: string;
  speaking: boolean;
  terminalVisible: string;
  meter: number;
  lockDecayScale: number;
  autoHold: boolean;
  flipped: boolean;
  reading: number;
  readCooldown: number;
  erasePrompt: boolean;
  erased: boolean | null;
  heardFlatlines: number;
  askRead(): boolean;
  setFlipped(on: boolean): void;
  setAutoHold(on: boolean): void;
  setMeter(v: number): void;
  mismatchKnobs(): void;
  startErase(): void;
  answerErase(yes: boolean): boolean;
  forceFlatline(scripted?: boolean): void;
  advance(dt: number): void;
  update(dt: number): void;
  paint(): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
  };
}

const dixie = (): DixieHandle | undefined =>
  (window as unknown as { __nonspaceDixie?: DixieHandle }).__nonspaceDixie;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceDixie?: DixieHandle }).__nonspaceDixie;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.update(0);
    a?.renderer.endFrame(0, null);
  });
}

test.describe('M7.2 Dixie companion', () => {
  // One ICE+HUD WebGL context at a time. Live rAF through a canvas screenshot
  // billed sibling SwiftShader `render.spec` dynres / `sector.spec` hitchesOver4ms.
  test.describe.configure({ mode: 'serial' });

  test('H-read, auto-hold, flatline, erase; freeze before snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=dixie&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    // Freeze before any canvas snapshot. Do not spin a live HUD + CRT rAF.
    await freezeLoop(page);
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'dixie');
    await expect(page.getByTestId('dixie-lab')).toBeVisible();
    await expect(page.getByTestId('dixie-license')).toContainText('ERASE CONSTRUCT? Y/N');
    await expect(page.getByTestId('dixie-license')).toContainText('design license');
    await page.waitForFunction(dixie);
    await paint(page);

    await page.locator('[data-testid="dixie-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(png.width).toBeGreaterThan(600);
    let lit = 0;
    let maxC = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxC) maxC = m;
      if (m > 18) lit++;
    }
    expect(maxC).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(400);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    const read = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceDixie: DixieHandle }).__nonspaceDixie;
      const started = h.askRead();
      h.advance(3.9);
      const before = h.lastLine;
      h.advance(0.2);
      return {
        started,
        before,
        after: h.lastLine,
        cooldown: h.readCooldown,
        again: h.askRead(),
      };
    });
    expect(read.started).toBe(true);
    expect(read.after).toBe("that's a three-two, kid");
    expect(read.again).toBe(false);
    expect(read.cooldown).toBeGreaterThan(10);

    const hold = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceDixie: DixieHandle }).__nonspaceDixie;
      h.mismatchKnobs();
      h.setMeter(0.8);
      h.setAutoHold(true);
      h.setFlipped(true);
      const scaleOn = h.lockDecayScale;
      h.advance(1);
      const meterOn = h.meter;
      h.setMeter(0.8);
      h.setAutoHold(false);
      const scaleOff = h.lockDecayScale;
      h.advance(1);
      const meterOff = h.meter;
      return { scaleOn, scaleOff, meterOn, meterOff };
    });
    expect(hold.scaleOn).toBeCloseTo(0.5, 5);
    expect(hold.scaleOff).toBe(1);
    expect(hold.meterOff).toBeLessThan(hold.meterOn);

    const flat = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceDixie: DixieHandle }).__nonspaceDixie;
      h.advance(2);
      h.forceFlatline(false);
      return { n: h.heardFlatlines, line: h.lastLine };
    });
    expect(flat.n).toBeGreaterThanOrEqual(1);
    expect(flat.line.length).toBeGreaterThan(0);

    const erase = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceDixie: DixieHandle }).__nonspaceDixie;
      h.startErase();
      const prompt = h.erasePrompt;
      const visible = h.terminalVisible;
      h.answerErase(true);
      return { prompt, visible, erased: h.erased, line: h.lastLine };
    });
    expect(erase.prompt).toBe(true);
    expect(erase.visible).toMatch(/ERASE CONSTRUCT\? Y\/N/);
    expect(erase.erased).toBe(true);

    await paint(page);
    expect(errors).toEqual([]);
    await page.goto('about:blank');
  });
});
