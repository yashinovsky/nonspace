import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** The slice of `window.__nonspace` this test touches. */
interface DebugHandle {
  input: {
    frame: {
      thrust: number;
      down(action: string): boolean;
      capturingText: boolean;
      textValue: string;
      pointerLocked: boolean;
    };
    bindings: { actions: Record<string, Array<{ type: string; code?: string }>> };
    beginTextCapture(): void;
    endTextCapture(): string;
    rebind(target: string, source: { type: string; code: string }, slot?: number): void;
  };
}

test('?lab=input shows live action states', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?lab=input');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  const lab = page.getByTestId('input-lab');
  await expect(lab).toBeVisible();
  await expect(lab).toContainText('scan');
  await expect(lab).toContainText('thrust');

  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.thrust ?? 0;
      });
    })
    .toBe(1);
  await expect(lab.locator('[data-axis="thrust"]')).toHaveAttribute('data-value', '1');
  await page.keyboard.up('w');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.thrust ?? 1;
      }),
    )
    .toBe(0);

  expect(errors).toEqual([]);
});

test('pointer lock enters on canvas click and exits on Escape', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = HTMLElement.prototype;
    const origReq = proto.requestPointerLock;
    const origExit = Document.prototype.exitPointerLock;
    const w = window as unknown as {
      __lockRequests: HTMLElement[];
      __lockExits: number;
    };
    w.__lockRequests = [];
    w.__lockExits = 0;
    proto.requestPointerLock = function (this: HTMLElement, ...args: unknown[]) {
      w.__lockRequests.push(this);
      return origReq.apply(this, args as []);
    };
    Document.prototype.exitPointerLock = function (this: Document) {
      w.__lockExits++;
      return origExit.apply(this);
    };
  });
  await page.goto('/?lab=input');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  const canvas = page.locator('#app > canvas');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  // Click the open centre of the canvas, not the lab panels at the edges.
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const clicked = await page.evaluate(() => {
    const w = window as unknown as { __lockRequests: HTMLElement[] };
    const canvasEl = document.querySelector('#app > canvas');
    return {
      requests: w.__lockRequests.length,
      onCanvas: w.__lockRequests[0] === canvasEl,
      locked: document.pointerLockElement !== null,
    };
  });
  expect(clicked.requests).toBeGreaterThan(0);
  expect(clicked.onCanvas).toBe(true);

  if (clicked.locked) {
    await expect(page.getByTestId('input-lab').locator('[data-flags]')).toHaveAttribute(
      'data-pointerlock',
      '1',
    );
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => page.evaluate(() => document.pointerLockElement !== null))
      .toBe(false);
  }
});

test('text-capture suspends actions', async ({ page }) => {
  await page.goto('/?lab=input');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  await page.getByTestId('text-capture').click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.capturingText;
      }),
    )
    .toBe(true);
  await page.keyboard.type('fw');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.textValue;
      }),
    )
    .toBe('fw');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.down('scan');
      }),
    )
    .toBe(false);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.thrust;
      }),
    )
    .toBe(0);
});

test('bindings persist across reload', async ({ page }) => {
  await page.goto('/?lab=input');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
    app!.input.rebind('scan', { type: 'key', code: 'KeyG' }, 0);
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  const code = await page.evaluate(() => {
    const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
    return app?.input.bindings.actions.scan[0]?.code;
  });
  expect(code).toBe('KeyG');
  await page.keyboard.down('g');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = (window as unknown as { __nonspace?: DebugHandle }).__nonspace;
        return app?.input.frame.down('scan');
      }),
    )
    .toBe(true);
});
