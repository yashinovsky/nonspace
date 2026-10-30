import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { EXTRA_SFX_IDS, SFX_PALETTE } from '../../src/audio/sfx/palette';

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('?lab=sfx exposes every palette SFX, FSK modem, Dixie, and a timed flatline', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.goto('/?lab=sfx');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'sfx-lab');
  await expect(page.getByTestId('sfx-unlock')).toBeVisible();

  for (const row of SFX_PALETTE) {
    await expect(page.getByTestId(`sfx-${row.id}`)).toBeVisible();
  }
  for (const id of EXTRA_SFX_IDS) {
    await expect(page.getByTestId(`sfx-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('sfx-modem-start')).toBeVisible();
  await expect(page.getByTestId('sfx-dixie-bark')).toBeVisible();
  await expect(page.getByTestId('sfx-dixie-laugh')).toBeVisible();
  await expect(page.getByTestId('sfx-event-flatline')).toBeVisible();
  await expect(page.getByTestId('sfx-flatline-visual')).toBeVisible();

  await page.getByTestId('sfx-unlock').click();
  await expect(page.locator('#app')).toHaveAttribute('data-unlocked', 'true');

  await page.getByTestId('sfx-jackIn').click();
  await page.getByTestId('sfx-modem-start').click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as unknown as {
            __nonspaceSfx?: { lab: { modemInfo(): { running: boolean; baud: number } } };
          };
          return w.__nonspaceSfx?.lab.modemInfo() ?? null;
        }),
      { timeout: 3_000 },
    )
    .toEqual(expect.objectContaining({ running: true, baud: 300 }));
  await page.getByTestId('sfx-modem-stop').click();

  await page.getByTestId('sfx-event-flatline').click();
  await expect
    .poll(async () => page.locator('#app').getAttribute('data-flatline-phase'), { timeout: 3_000 })
    .toMatch(/beeps|tone|linger|silence/);
  await expect
    .poll(async () => page.locator('#app').getAttribute('data-flatline-phase'), { timeout: 6_000 })
    .toMatch(/tone|linger|silence|done/);

  expect(errors).toEqual([]);
});
