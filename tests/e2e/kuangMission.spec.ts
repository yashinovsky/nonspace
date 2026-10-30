import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SHOT_ASCENT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-9-ascent.png',
);
const SHOT_DIVE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m7-9-dive.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface KuangMissionHandle {
  missionId: string;
  status: string;
  mode: string;
  phase: string;
  checkpoint: string | null;
  knot: string | null;
  ended: boolean;
  won: boolean;
  mimic: number;
  reveal: number;
  segment: number;
  gatesCleared: number;
  divePhase: string;
  flipped: boolean;
  pain: number;
  hijackText: string;
  jane: boolean;
  jackOutBlocked: boolean;
  soften: number;
  beach: boolean;
  handoff: string;
  mollyGates: string;
  skipJackIn(): void;
  completeAscent(): void;
  deployKuang(): void;
  enterDive(): void;
  enterGate(): void;
  crackGate(): void;
  playMollyGate(index: number): void;
  flip(on?: boolean): void;
  intercept(): void;
  tryJackOut(): string;
  skipOverlay(): void;
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

const mission = (): KuangMissionHandle | undefined =>
  (window as unknown as { __nonspaceMission?: KuangMissionHandle }).__nonspaceMission;

async function freezeLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: AppHandle }).__nonspace;
    app?.renderer.three.setAnimationLoop(null);
  });
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __nonspaceMission?: KuangMissionHandle }).__nonspaceMission;
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

test.describe('M7.9 mission M5 Kuang Grade Mark Eleven', () => {
  test.describe.configure({ mode: 'serial' });

  test('?mission=m5 plays phases A–E with interleaved simstim and beach handoff', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?mission=m5&quality=medium');
      await page.waitForFunction(mission);
      await freezeLoop(page);
      await expect(page.locator('#app')).toHaveAttribute('data-mission', 'm5');

      const opening = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        h.advance(0);
        return { missionId: h.missionId, mode: h.mode, knot: h.knot, phase: h.phase };
      });
      expect(opening.missionId).toBe('m5');
      expect(opening.mode).toBe('interlude');
      expect(opening.knot).toBe('brief');

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        h.skipJackIn();
        h.advance(0);
        h.completeAscent();
        h.advance(0);
      });

      await paint(page);
      const canvas = page.locator('#app > canvas');
      const png0 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats0 = litStats(png0);
      expect(stats0.max).toBeGreaterThan(30);
      expect(stats0.lit).toBeGreaterThan(80);
      expect(stats0.black / stats0.n).toBeGreaterThan(0.15);
      mkdirSync(dirname(SHOT_ASCENT), { recursive: true });
      writeFileSync(SHOT_ASCENT, PNG.sync.write(png0, { deflateLevel: 9 }));

      const deployed = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        h.deployKuang();
        h.advance(0);
        return { mimic: h.mimic, reveal: h.reveal, phase: h.phase, checkpoint: h.checkpoint };
      });
      expect(deployed.mimic).toBeGreaterThan(0.9);
      expect(deployed.reveal).toBeGreaterThan(0.9);
      expect(deployed.phase).toBe('deploy');

      await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        h.enterDive();
        h.advance(0);
      });

      await paint(page);
      const png1 = PNG.sync.read(await canvas.screenshot({ animations: 'disabled' }));
      const stats1 = litStats(png1);
      expect(stats1.max).toBeGreaterThan(30);
      expect(stats1.lit).toBeGreaterThan(80);
      expect(stats1.black / stats1.n).toBeGreaterThan(0.12);
      mkdirSync(dirname(SHOT_DIVE), { recursive: true });
      writeFileSync(SHOT_DIVE, PNG.sync.write(png1, { deflateLevel: 9 }));

      const dive = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        const molly: Array<{
          gates: string;
          pain: number;
          hijack: string;
          jane: boolean;
          flipped: boolean;
        }> = [];
        for (let i = 0; i < 3; i++) {
          h.enterGate();
          h.advance(0);
          h.crackGate();
          h.advance(0);
          h.playMollyGate(i);
          h.advance(0);
          molly.push({
            gates: h.mollyGates,
            pain: h.pain,
            hijack: h.hijackText,
            jane: h.jane,
            flipped: h.flipped,
          });
          h.flip(false);
          h.advance(0);
        }
        return {
          phase: h.phase,
          gatesCleared: h.gatesCleared,
          molly,
        };
      });
      expect(dive.gatesCleared).toBe(3);
      expect(dive.molly[0]?.gates).toMatch(/hit/);
      expect(dive.molly[1]?.pain).toBeGreaterThan(0.5);
      expect(dive.molly[1]?.hijack).toMatch(/COUNTING/i);
      expect(dive.molly[2]?.jane).toBe(true);

      const end = await page.evaluate(() => {
        const h = (window as unknown as { __nonspaceMission: KuangMissionHandle })
          .__nonspaceMission;
        h.intercept();
        h.advance(0);
        const blocked = h.tryJackOut();
        const soften = h.soften;
        const jackOutBlocked = h.jackOutBlocked;
        h.skipOverlay();
        h.advance(0);
        return {
          blocked,
          soften,
          jackOutBlocked,
          beach: h.beach,
          handoff: h.handoff,
          won: h.won,
          ended: h.ended,
          mode: h.mode,
          status: h.status,
        };
      });
      expect(end.blocked).toMatch(/WON'T LET GO|WONT LET GO/i);
      expect(end.jackOutBlocked).toBe(true);
      expect(end.soften).toBeGreaterThan(0.5);
      expect(end.beach || end.mode === 'beach' || end.handoff === 'm6').toBe(true);
      expect(end.won || end.status === 'won' || end.ended).toBe(true);

      expect(errors.filter((e) => !e.includes('AudioContext'))).toEqual([]);
    } finally {
      await dropPage(page);
    }
  });
});
