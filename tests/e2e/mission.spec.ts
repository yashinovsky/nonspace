import { expect, test } from '@playwright/test';

interface DebugHandle {
  mission: {
    def: { id: string } | null;
    status: string;
    checkpointId: string | null;
    time: number;
    flag(name: string): boolean;
  };
}

const handle = (): DebugHandle | undefined =>
  (window as unknown as { __nonspace?: DebugHandle }).__nonspace;

test('?mission=&checkpoint= loads a mock run and seeks start', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/?debug&mission=mock-triggers&checkpoint=start');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  await page.waitForFunction(handle);

  const gui = page.getByTestId('debug-gui');
  await expect(gui).toBeVisible();
  await expect(gui).toContainText('mission');
  const idField = gui.locator('.tp-lblv', { hasText: 'id' }).first().locator('input');
  await expect(idField).toHaveValue('mock-triggers');

  const info = await page.evaluate(() => {
    const app = (window as unknown as { __nonspace: DebugHandle }).__nonspace;
    return {
      id: app.mission.def?.id ?? null,
      status: app.mission.status,
      checkpoint: app.mission.checkpointId,
      time: app.mission.time,
    };
  });
  expect(info.id).toBe('mock-triggers');
  expect(info.status).toBe('running');
  expect(info.checkpoint).toBe('start');

  await page.waitForFunction(() => {
    const app = (window as unknown as { __nonspace: DebugHandle }).__nonspace;
    return app.mission.time > 0.2;
  });

  expect(errors).toEqual([]);
});
