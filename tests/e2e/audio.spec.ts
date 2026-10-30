import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

interface AudioDiag {
  unlocked: boolean;
  contextState: string | null;
  sampleRate: number | null;
  baseLatency: number | null;
  bufferFrames: number | null;
  fmActive: number;
  fmSize: number;
  worklets: { fm: boolean; noise: boolean };
  motifCount: number;
  duckGain: { all: number; music: number };
  panningModel: string | null;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const diag = (): AudioDiag | null =>
  (
    window as unknown as { __nonspaceAudio?: { diagnostics(): AudioDiag | null } }
  ).__nonspaceAudio?.diagnostics() ?? null;

test('?lab=audio unlocks on gesture, plays 16 FM voices, ducks, and HRTF-pans a motif', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.goto('/?lab=audio');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'audio-lab');
  await expect(page.getByTestId('audio-unlock')).toBeVisible();

  await page.getByTestId('audio-unlock').click();
  await expect(page.locator('#app')).toHaveAttribute('data-unlocked', 'true');

  const afterUnlock = await page.evaluate(diag);
  expect(afterUnlock?.unlocked).toBe(true);
  expect(afterUnlock?.contextState).toBe('running');
  expect(afterUnlock?.sampleRate).toBeGreaterThan(0);
  expect(afterUnlock?.fmSize).toBe(16);
  expect(afterUnlock?.worklets.fm).toBe(true);
  expect(afterUnlock?.worklets.noise).toBe(true);

  await page.getByTestId('audio-chord').click();
  await expect
    .poll(async () => (await page.evaluate(diag))?.fmActive ?? 0, { timeout: 5_000 })
    .toBe(16);

  await page.getByTestId('audio-duck-music').click();
  await expect
    .poll(async () => (await page.evaluate(diag))?.duckGain.music ?? 1, { timeout: 3_000 })
    .toBeLessThan(0.2);

  await page.getByTestId('audio-motif-attach').click();
  await expect
    .poll(async () => (await page.evaluate(diag))?.motifCount ?? 0, { timeout: 3_000 })
    .toBe(1);
  const withMotif = await page.evaluate(diag);
  expect(withMotif?.panningModel).toBe('HRTF');

  await page.getByTestId('audio-stop').click();
  await page.getByTestId('audio-motif-detach').click();

  expect(errors).toEqual([]);
});

test('?lab=audio adaptive music states crossfade and expose pulse', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/?lab=audio');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'audio-lab');

  await page.getByTestId('audio-unlock').click();
  await expect(page.locator('#app')).toHaveAttribute('data-unlocked', 'true');

  await page.getByTestId('audio-music-transit').click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => {
            const d = (
              window as unknown as {
                __nonspaceAudio?: {
                  diagnostics(): { music: { state: string }; pulse: number } | null;
                };
              }
            ).__nonspaceAudio?.diagnostics();
            return d ? { state: d.music.state, pulse: d.pulse } : null;
          })
        )?.state ?? '',
      { timeout: 3_000 },
    )
    .toBe('transit');

  await page.getByTestId('audio-music-approach').click();
  await expect(page.getByTestId('audio-pulse')).toContainText('pulse');
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => {
            const d = (
              window as unknown as {
                __nonspaceAudio?: {
                  diagnostics(): {
                    music: { state: string };
                    crossfade: { progress: number } | null;
                  } | null;
                };
              }
            ).__nonspaceAudio?.diagnostics();
            return d;
          })
        )?.music.state ?? '',
      { timeout: 3_000 },
    )
    .toBe('approach');

  expect(errors).toEqual([]);
});
