import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m3-2-hud.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface HudLayout {
  width: number;
  height: number;
  aspect: number;
  reticle: { x: number; y: number };
  radar: { x: number; y: number; w: number; h: number };
  pip: { x: number; y: number; w: number; h: number };
  strip: { x: number; y: number; w: number; h: number };
  terminal: { x: number; y: number; w: number; h: number };
  periscope: { tl: { x: number; y: number }; tr: { x: number; y: number } };
}

interface HudHandle {
  neural: number;
  trace: number;
  flatline: boolean;
  terminalVisible: string;
  terminalPending: number;
  eegVariance: number;
  layout: HudLayout;
  setNeural(n: number): void;
  setTrace(n: number): void;
  setFlatline(on: boolean): void;
  print(text: string, wintermute?: boolean): void;
  clearTerminal(): void;
  update(dt: number): void;
}

interface AppHandle {
  renderer: {
    cssWidth: number;
    cssHeight: number;
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    resize(w: number, h: number, dpr: number): void;
    chain: { vectorCrt: { params: { enableBarrel: boolean } } };
  };
}

const hud = (): HudHandle | undefined =>
  (window as unknown as { __nonspaceHud?: HudHandle }).__nonspaceHud;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.renderer.three.setAnimationLoop(null);
  });
}

async function draw(page: Page, dt = 1 / 60): Promise<void> {
  await page.evaluate((step) => {
    const h = (window as unknown as { __nonspaceHud?: HudHandle }).__nonspaceHud;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.update(step);
    a?.renderer.endFrame(step, null);
  }, dt);
}

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

function regionLit(png: PNG, x0: number, y0: number, x1: number, y1: number, thresh = 20): number {
  let n = 0;
  const xa = Math.max(0, Math.min(png.width - 1, Math.floor(x0)));
  const xb = Math.max(0, Math.min(png.width - 1, Math.floor(x1)));
  const ya = Math.max(0, Math.min(png.height - 1, Math.floor(y0)));
  const yb = Math.max(0, Math.min(png.height - 1, Math.floor(y1)));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (lumaAt(png, x, y) > thresh) n++;
    }
  }
  return n;
}

function cssToPng(layoutY: number, cssH: number, pngH: number): number {
  return Math.round((1 - layoutY / cssH) * (pngH - 1));
}

test.describe('M3.2 HUD', () => {
  test('composites after CRT, types at 1200 baud, EEG morphs, layout holds', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=hud&quality=high');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'hud');
    await expect(page.getByTestId('hud-lab')).toBeVisible();
    await page.waitForFunction(hud);
    // Freeze before any canvas snapshot. Do not spin live HUD + CRT frames —
    // a 1080p animation loop starves sibling SwiftShader workers (loop / grid / points).
    await freezeLoop(page);
    await draw(page, 1 / 60);

    await page.locator('[data-testid="hud-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
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
    expect(maxC).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(400);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

    const meta = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceHud: HudHandle }).__nonspaceHud;
      const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
      return {
        layout: h.layout,
        cssW: a.renderer.cssWidth,
        cssH: a.renderer.cssHeight,
        barrel: a.renderer.chain.vectorCrt.params.enableBarrel,
        cps: document.getElementById('app')?.dataset.terminalCps,
      };
    });
    expect(meta.cps).toBe('120');
    expect(meta.barrel).toBe(true);
    expect(meta.layout.aspect).toBeCloseTo(16 / 9, 2);
    expect(meta.layout.reticle.x).toBeCloseTo(meta.layout.width / 2, 0);

    const cssH = meta.cssH;
    const tl = meta.layout.periscope.tl;
    const tlPx = {
      x: Math.round((tl.x / meta.cssW) * png.width),
      y: cssToPng(tl.y, cssH, png.height),
    };
    const pad = 14;
    const cornerLit = regionLit(png, tlPx.x - pad, tlPx.y - pad, tlPx.x + pad, tlPx.y + pad);
    expect(cornerLit).toBeGreaterThan(8);

    await page.evaluate(() => {
      const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
      a.renderer.chain.vectorCrt.params.enableBarrel = false;
    });
    await draw(page, 0);
    const pngOff = PNG.sync.read(await canvas.screenshot({ animations: 'allow' }));
    const cornerOff = regionLit(pngOff, tlPx.x - pad, tlPx.y - pad, tlPx.x + pad, tlPx.y + pad);
    expect(cornerOff).toBeGreaterThan(8);

    const eeg = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceHud: HudHandle }).__nonspaceHud;
      h.setFlatline(false);
      h.setNeural(0);
      h.update(0);
      const calm = h.eegVariance;
      h.setNeural(100);
      h.update(0);
      const ragged = h.eegVariance;
      h.setFlatline(true);
      h.update(0);
      const flat = h.eegVariance;
      return { calm, ragged, flat };
    });
    expect(eeg.ragged).toBeGreaterThan(eeg.calm);
    expect(eeg.flat).toBeLessThan(0.02);

    const typed = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceHud: HudHandle }).__nonspaceHud;
      h.clearTerminal();
      h.print('ABCDEFGHIJ');
      h.update(3 / 120);
      const baud = h.terminalVisible;
      h.print('WINTERMUTE> INSTANT LINE', true);
      const wm = h.terminalVisible;
      return { baud, wm };
    });
    expect(typed.baud.length).toBeGreaterThan(0);
    expect(typed.baud.length).toBeLessThan(10);
    expect(typed.wm).toBe('WINTERMUTE> INSTANT LINE');

    for (const size of [
      { w: 840, h: 360, aspect: 21 / 9 },
      { w: 480, h: 360, aspect: 4 / 3 },
    ]) {
      await page.setViewportSize({ width: size.w, height: size.h });
      const L = await page.evaluate(
        (wh) => {
          const a = (window as unknown as { __nonspace: AppHandle }).__nonspace;
          const h = (window as unknown as { __nonspaceHud: HudHandle }).__nonspaceHud;
          a.renderer.resize(wh.w, wh.h, 1);
          h.update(0);
          return h.layout;
        },
        { w: size.w, h: size.h },
      );
      expect(L.aspect).toBeCloseTo(size.aspect, 2);
      expect(L.reticle.x).toBeCloseTo(L.width / 2, 0);
      expect(L.radar.x).toBeGreaterThan(L.width * 0.55);
      expect(L.strip.y).toBeLessThan(L.height * 0.25);
      expect(L.pip.x + L.pip.w).toBeLessThanOrEqual(L.width);
    }

    expect(errors).toEqual([]);
  });
});
