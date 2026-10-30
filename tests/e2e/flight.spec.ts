import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

interface DebugHandle {
  flight: {
    telemetry: { speed: number; altitude: number };
    params: { gridAssist: boolean };
  };
}

test('?lab=flight flies under WASD and exposes §3.3 params in the debug GUI', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?lab=flight&debug');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  const lab = page.getByTestId('flight-lab');
  await expect(lab).toBeVisible();
  await expect(lab).toContainText('FLIGHT');

  const gui = page.getByTestId('debug-gui');
  await expect(gui).toBeVisible();
  await expect(gui).toContainText('cruise u/s');
  await expect(gui).toContainText('boost u/s');
  await expect(gui).toContainText('assist cone');

  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.flight.telemetry.speed ?? 0;
      });
    })
    .toBeGreaterThan(5);
  await page.keyboard.up('w');

  const assist = page.getByTestId('flight-toggle-gridAssist');
  await expect(assist).toBeChecked();
  await assist.uncheck();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.flight.params.gridAssist ?? true;
      }),
    )
    .toBe(false);

  expect(errors).toEqual([]);
});
