import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const WINTERMUTE_SHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-3-wintermute.png',
);
const NEUROMANCER_SHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-3-neuromancer.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface AiHandle {
  scene: string;
  overexpose: number;
  soften: number;
  frozen: boolean;
  hijackText: string;
  personaWho: string | null;
  bloomRadius: number;
  warpOn: boolean;
  warpDelta: number;
  jackOutBlocked: boolean;
  debt: number;
  applyWintermute(action: { kind: string; [k: string]: unknown }): void;
  applyNeuromancer(action: { kind: string; [k: string]: unknown }): void;
  setScene(scene: string): void;
  reset(): void;
  setTime(t: number): void;
  update(dt: number): void;
}

interface AppHandle {
  renderer: {
    three: { setAnimationLoop(fn: null): void };
    endFrame(dt: number, gpuMs: number | null): void;
    quality: { bloomMips: number; tier: string };
  };
}

const ai = (): AiHandle | undefined =>
  (window as unknown as { __nonspaceAi?: AiHandle }).__nonspaceAi;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceAi?: AiHandle }).__nonspaceAi;
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.update(0);
    app?.renderer.endFrame(0, null);
  });
}

function lumaAt(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

function meanCenter(png: PNG): { luma: number; r: number; g: number; b: number; lit: number } {
  const cx = Math.floor(png.width / 2);
  const cy = Math.floor(png.height / 2);
  const rx = Math.floor(png.width * 0.18);
  const ry = Math.floor(png.height * 0.22);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let lit = 0;
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const i = (y * png.width + x) * 4;
      r += png.data[i]!;
      g += png.data[i + 1]!;
      b += png.data[i + 2]!;
      n++;
      if (lumaAt(png, x, y) > 18) lit++;
    }
  }
  return {
    luma: n ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / n : 0,
    r: n ? r / n : 0,
    g: n ? g / n : 0,
    b: n ? b / n : 0,
    lit,
  };
}

test.describe('M7.3 AI presences', () => {
  test('overexpose, persona, reverse, freeze, bend, soften; freeze rAF first', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=ai&scene=overexpose&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'ai');
    await expect(page.getByTestId('ai-lab')).toBeVisible();
    await page.waitForFunction(ai);
    // Freeze before any canvas snapshot. Do not spin live bloom+warp frames —
    // 1080p quality=high starves sibling SwiftShader workers (loop / grid / points).
    await freezeLoop(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi?: AiHandle }).__nonspaceAi;
      h?.setTime(0.35);
    });
    await paint(page);

    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-overexpose', /^(0\.[5-9]|1)/);
    await expect(app).toHaveAttribute('data-persona', 'finn');
    await expect(app).toHaveAttribute('data-bloom-radius', '2');

    await page.locator('[data-testid="ai-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const canvas = page.locator('#app > canvas');
    const wmPng = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
    expect(wmPng.width).toBeGreaterThan(600);
    const wm = meanCenter(wmPng);
    expect(wm.lit).toBeGreaterThan(80);
    expect(wm.luma).toBeGreaterThan(12);
    mkdirSync(dirname(WINTERMUTE_SHOT), { recursive: true });
    writeFileSync(WINTERMUTE_SHOT, PNG.sync.write(wmPng, { deflateLevel: 9 }));

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi?: AiHandle }).__nonspaceAi;
      h?.applyWintermute({ kind: 'overexpose', amount: 0 });
      h?.applyWintermute({ kind: 'persona', who: 'finn', on: false });
    });
    await paint(page);
    const reversed = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      const root = document.querySelector('#app') as HTMLElement;
      return {
        over: h.overexpose,
        bloom: h.bloomRadius,
        persona: h.personaWho,
        bloomAttr: root.dataset.bloomRadius,
      };
    });
    expect(reversed.over).toBe(0);
    expect(reversed.bloom).toBe(1);
    expect(reversed.persona).toBeNull();

    const frozen = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      const root = document.querySelector('#app') as HTMLElement;
      h.applyWintermute({ kind: 'hijack', text: 'WINTERMUTE> I NEED A RIDER' });
      h.applyWintermute({ kind: 'freeze', on: true });
      h.applyWintermute({
        kind: 'gridBend',
        points: [
          { x: -48, z: 40, strength: 0.8 },
          { x: 48, z: 40, strength: 0.8 },
          { x: -56, z: -90, strength: 0.68 },
          { x: 56, z: -90, strength: 0.68 },
        ],
      });
      h.applyWintermute({ kind: 'bargain', offerId: 'opens-the-door', debt: 1 });
      h.update(0);
      const phi0 = root.dataset.icePhi;
      h.update(0.1);
      return {
        frozen: h.frozen,
        hijack: h.hijackText,
        warp: h.warpOn,
        delta: h.warpDelta,
        debt: h.debt,
        phi: root.dataset.icePhi,
        phi0,
      };
    });
    await paint(page);
    expect(frozen.frozen).toBe(true);
    expect(frozen.hijack).toContain('WINTERMUTE');
    expect(frozen.warp).toBe(true);
    expect(frozen.delta).toBeGreaterThan(0.5);
    expect(frozen.debt).toBe(1);
    expect(frozen.phi).toBe(frozen.phi0);

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      h.applyWintermute({ kind: 'gridBend', points: [] });
      h.applyWintermute({ kind: 'freeze', on: false });
    });
    await paint(page);
    const unbent = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      return { warp: h.warpOn, delta: h.warpDelta };
    });
    expect(unbent.warp).toBe(false);
    expect(unbent.delta).toBeLessThan(0.05);

    await page.goto('/?lab=ai&scene=soften&quality=medium');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'ai');
    await page.waitForFunction(ai);
    await freezeLoop(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi?: AiHandle }).__nonspaceAi;
      h?.setTime(0.4);
    });
    await paint(page);
    await expect(page.locator('#app')).toHaveAttribute('data-soften', /^(0\.[5-9]|1)/);
    await expect(page.locator('#app')).toHaveAttribute('data-overexpose', '0.000');
    await page.locator('[data-testid="ai-lab"]').evaluate((el) => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
    const nmCanvas = page.locator('#app > canvas');
    const nmPng = PNG.sync.read(await nmCanvas.screenshot({ animations: 'disabled' }));
    const nm = meanCenter(nmPng);
    expect(nm.lit).toBeGreaterThan(40);
    expect(nm.r).toBeGreaterThan(nm.b * 0.7);
    writeFileSync(NEUROMANCER_SHOT, PNG.sync.write(nmPng, { deflateLevel: 9 }));

    await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      h.applyNeuromancer({ kind: 'soften', amount: 0 });
      h.applyNeuromancer({ kind: 'pull', target: { x: 0, y: 16, z: 8 }, strength: 40 });
    });
    await paint(page);
    const pulled = await page.evaluate(() => {
      const h = (window as unknown as { __nonspaceAi: AiHandle }).__nonspaceAi;
      return { soften: h.soften, blocked: h.jackOutBlocked };
    });
    expect(pulled.soften).toBe(0);
    expect(pulled.blocked).toBe(true);

    expect(errors.filter((e) => !/WebGL|EXT_disjoint/i.test(e))).toEqual([]);
  });
});
