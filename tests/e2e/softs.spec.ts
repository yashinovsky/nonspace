import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m4-4-softs.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface SoftsHandle {
  scene: string;
  engaged: boolean;
  neural: number;
  knobs: { R: number; Phi: number };
  ratio: readonly [number, number] | null;
  phi: number;
  nextRekeyAt: number | null;
  revealLabel: string | null;
  decoyActive: boolean;
  watcherLured: boolean;
  freezeDrift: boolean;
  feedbackMul: number;
  traceMul: number;
  lastUsed: string | null;
  lastFail: string | null;
  hudSofts: Array<{ label: string; cooldown: number }>;
  charges(id: string): number | undefined;
  cooldown(id: string): number;
  use(id: string): boolean;
  askDixie(): boolean;
  snapshot(): unknown;
  restore(state: unknown): void;
  setKnobs(lnR: number, Phi: number): void;
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

const ready = (): boolean => {
  const w = window as unknown as { __nonspaceSofts?: SoftsHandle; __nonspace?: AppHandle };
  return !!(w.__nonspaceSofts && w.__nonspace?.renderer.three);
};

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceSofts?: SoftsHandle }).__nonspaceSofts;
    const a = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    h?.paint();
    a?.renderer.endFrame(0, null);
  });
}

/** Release the WebGL context so sibling SwiftShader workers (sector hitchesOver4ms / loop lag) are not starved. */
async function dropPage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
      app?.renderer.three.setAnimationLoop(null);
      app?.dispose();
    });
  } catch {
    // Page may already be closing.
  }
  try {
    await page.goto('about:blank');
  } catch {
    // ignore
  }
}

test.describe('M4.4 softs', () => {
  // One ICE+HUD WebGL context at a time. Leftover SwiftShader after a
  // canvas screenshot billed sibling `loop.spec` / `sector.spec` hitchesOver4ms.
  test.describe.configure({ mode: 'serial' });

  test('each effect is verifiable; freeze before snapshot', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?lab=phaselock3d&scene=probe&quality=medium');
      // Freeze as soon as handles exist — waiting on data-status=running spins
      // live ICE+HUD rAF (now also Dixie) and bills sibling sector/loop.
      await page.waitForFunction(ready);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-lab', 'phaselock3d');
      await expect(page.getByTestId('softs-lab')).toBeVisible();
      await paint(page);

      const probe = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceSofts: SoftsHandle }).__nonspaceSofts;
        return {
          engaged: h.engaged,
          label: h.revealLabel,
          ratio: h.ratio,
          charges: h.charges('probe'),
          slots: h.hudSofts.map((s) => s.label),
        };
      });
      expect(probe.engaged).toBe(true);
      expect(probe.label).toMatch(/^\d+:\d+$/);
      expect(probe.charges).toBe(2);
      expect(probe.slots[0]).toBe('PROBE');

      await page.locator('[data-testid="softs-lab"]').evaluate((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
      });
      await freezeLoop(page);
      await paint(page);
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
      expect(maxC).toBeGreaterThan(30);
      expect(lit).toBeGreaterThan(200);
      mkdirSync(dirname(SCREENSHOT), { recursive: true });
      writeFileSync(SCREENSHOT, PNG.sync.write(png, { deflateLevel: 9 }));

      const rest = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceSofts: SoftsHandle }).__nonspaceSofts;
        const phi0 = h.phi;
        const rekey0 = h.nextRekeyAt;
        const clampOk = h.use('clamp');
        h.advance(0.4);
        const afterClamp = {
          freeze: h.freezeDrift,
          dPhi: Math.abs(h.phi - phi0),
          rekey: h.nextRekeyAt,
          rekey0,
          cd: h.cooldown('clamp'),
        };
        const snap = h.snapshot();
        const damperOk = h.use('damper');
        const decoyOk = h.use('decoy');
        const neural0 = h.neural;
        h.setKnobs(Math.log(0.25), 0);
        h.advance(0.5);
        const afterDecoy = {
          decoy: h.decoyActive,
          lured: h.watcherLured,
          traceMul: h.traceMul,
          feedbackMul: h.feedbackMul,
          neural: h.neural - neural0,
        };
        h.restore(snap);
        const restored = { probe: h.charges('probe'), clampCd: h.cooldown('clamp') };
        h.setKnobs(0, 0);
        const mimicOk = h.use('mimic');
        const before = { ...h.knobs };
        h.advance(1);
        const afterMimic = { before, after: { ...h.knobs }, ratio: h.ratio };
        const kuangOk = h.use('kuang');
        const dixieOk = h.askDixie();
        return {
          clampOk,
          afterClamp,
          damperOk,
          decoyOk,
          afterDecoy,
          restored,
          mimicOk,
          afterMimic,
          kuangOk,
          dixieOk,
          lastFail: h.lastFail,
          lastUsed: h.lastUsed,
        };
      });

      expect(rest.clampOk).toBe(true);
      expect(rest.afterClamp.freeze).toBe(true);
      expect(rest.afterClamp.dPhi).toBeLessThan(1e-4);
      expect(rest.afterClamp.rekey).not.toBeNull();
      expect((rest.afterClamp.rekey ?? 0) - (rest.afterClamp.rekey0 ?? 0)).toBeGreaterThan(4.5);
      expect(rest.afterClamp.cd).toBeGreaterThan(14);

      expect(rest.damperOk).toBe(true);
      expect(rest.decoyOk).toBe(true);
      expect(rest.afterDecoy.decoy).toBe(true);
      expect(rest.afterDecoy.lured).toBe(true);
      expect(rest.afterDecoy.traceMul).toBe(0.5);
      expect(rest.afterDecoy.feedbackMul).toBe(0.3);

      expect(rest.restored.probe).toBe(2);
      expect(rest.restored.clampCd).toBeGreaterThan(14);

      expect(rest.mimicOk).toBe(true);
      expect(rest.afterMimic.after.R).not.toBeCloseTo(rest.afterMimic.before.R, 5);

      expect(rest.kuangOk).toBe(true);
      expect(rest.dixieOk).toBe(true);
      expect(rest.lastFail).toBeNull();
      expect(rest.lastUsed).toBe('dixie-read');

      expect(errors).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
