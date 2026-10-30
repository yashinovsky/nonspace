import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots/m2-1-grammar-ziggurat.png',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface GrammarHandle {
  kind: string;
  lod: string;
  stats: { segments: number; triangles: number; points: number };
  setKind(kind: string): void;
  setLod(lod: string): void;
}

const handle = (): GrammarHandle | undefined =>
  (window as unknown as { __nonspaceGrammar?: GrammarHandle }).__nonspaceGrammar;

test.describe('M2.1 construct grammar lab', () => {
  test('?lab=grammar&g=ziggurat draws the ESFA steps with live sliders', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?lab=grammar&g=ziggurat');
    await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#app')).toHaveAttribute('data-lab', 'grammar');
    await expect(page.getByTestId('grammar-lab')).toContainText('GRAMMAR');
    await expect(page.getByTestId('grammar-gui')).toBeVisible();
    await expect(page.getByTestId('grammar-gui')).toContainText('primitive');
    await expect(page.getByTestId('grammar-gui')).toContainText('steps');

    await page.waitForFunction(handle);

    const near = await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
      return g.stats;
    });
    expect(near.segments).toBeGreaterThan(12);
    expect(near.triangles).toBeGreaterThan(0);

    await page.waitForTimeout(350);
    const canvas = page.locator('#app > canvas');
    const png = PNG.sync.read(await canvas.screenshot());
    let maxChannel = 0;
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const m = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (m > maxChannel) maxChannel = m;
      if (m > 16) lit++;
    }
    expect(maxChannel).toBeGreaterThan(40);
    expect(lit).toBeGreaterThan(200);
    mkdirSync(dirname(SCREENSHOT), { recursive: true });
    writeFileSync(SCREENSHOT, PNG.sync.write(png));

    await page.evaluate(() => {
      (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar.setLod('mid');
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
          return g.stats.segments;
        }),
      )
      .toBeGreaterThanOrEqual(12);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
          return g.stats.segments;
        }),
      )
      .toBeLessThanOrEqual(24);

    await page.evaluate(() => {
      (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar.setLod('far');
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
          return g.stats.points;
        }),
      )
      .toBe(1);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
          return g.stats.segments;
        }),
      )
      .toBe(0);

    await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
      g.setLod('near');
      g.setKind('cubeStack');
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
          return g.kind;
        }),
      )
      .toBe('cubeStack');
    const cubes = await page.evaluate(() => {
      const g = (window as unknown as { __nonspaceGrammar: GrammarHandle }).__nonspaceGrammar;
      return g.stats;
    });
    expect(cubes.segments).toBeGreaterThan(12);

    expect(errors).toEqual([]);
  });
});
