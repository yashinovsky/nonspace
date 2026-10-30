import { expect, test } from '@playwright/test';

/** The slice of `window.__nonspace` (src/app/App.ts) this test touches. */
interface DebugHandle {
  loop: {
    stats: {
      ticks: number;
      simTime: number;
      frames: number;
      droppedTime: number;
      maxStepsPerFrame: number;
    };
  };
  modes: {
    push(mode: {
      id: string;
      simulatesWhenCovered: boolean;
      enter(): void;
      exit(): void;
      update(dt: number): void;
      render(alpha: number): void;
      handleInput(frame: unknown): void;
    }): void;
    pop(): void;
  };
}
const handle = (): DebugHandle | undefined =>
  (window as unknown as { __nonspace?: DebugHandle }).__nonspace;

test('sim runs at fixed 60 Hz steps under a throttled CPU', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/?debug');
  await expect(page.locator('#app')).toHaveAttribute('data-status', 'running');
  await page.waitForFunction(handle);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const result = await page.evaluate(async () => {
    const app = (window as unknown as { __nonspace: DebugHandle }).__nonspace;
    const dts = new Set<number>();
    let updates = 0;
    let renders = 0;
    app.modes.push({
      id: 'matrix',
      simulatesWhenCovered: true,
      enter() {},
      exit() {},
      update(dt) {
        dts.add(dt);
        updates++;
      },
      render() {
        renders++;
      },
      handleInput() {},
    });

    // Starve every frame: ~50 ms of busy work on top of the 4x CPU throttle.
    let burning = true;
    const burn = (): void => {
      const until = performance.now() + 50;
      while (performance.now() < until);
      if (burning) requestAnimationFrame(burn);
    };
    requestAnimationFrame(burn);
    await new Promise((r) => setTimeout(r, 300));

    const s0 = { ...app.loop.stats };
    const t0 = performance.now();
    const u0 = updates;
    const r0 = renders;
    await new Promise((r) => setTimeout(r, 3000));
    const s1 = { ...app.loop.stats };
    const wall = (performance.now() - t0) / 1000;
    burning = false;
    app.modes.pop();

    return {
      wall,
      sim: s1.simTime - s0.simTime,
      dropped: s1.droppedTime - s0.droppedTime,
      ticks: s1.ticks - s0.ticks,
      frames: s1.frames - s0.frames,
      updates: updates - u0,
      renders: renders - r0,
      maxSteps: s1.maxStepsPerFrame,
      dts: [...dts],
    };
  });

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(JSON.stringify(result));

  // Frames were slow (well under 60 fps), so the loop caught up with several steps per frame.
  expect(result.frames / result.wall).toBeLessThan(25);
  expect(result.maxSteps).toBeGreaterThanOrEqual(3);
  // Every step was the same fixed dt, and the mode on the stack saw every one.
  expect(result.dts).toEqual([1 / 60]);
  expect(result.updates).toBe(result.ticks);
  expect(result.renders).toBe(result.frames);
  // Sim + dropped tracks wall (clamped frames count as dropped). Under 4× throttle
  // and a 50 ms rAF burn, the HDR post chain (M0.4) and input sample (M0.3) can
  // push a few CI SwiftShader frames over maxFrameTime, so sim may lag ~10–30%.
  expect(Math.abs(result.sim + result.dropped - result.wall)).toBeLessThan(0.2);
  expect(result.sim).toBeGreaterThan(result.wall * 0.7);

  expect(errors).toEqual([]);
});
