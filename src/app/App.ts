import { WebGLRenderer } from 'three';
import { createEventBus, type EventBus } from '../core/events';
import { createLoop, type Loop } from '../core/loop';
import { createSaveStore, type SaveStore } from '../core/save';
import { createSettingsStore, type SettingsStore } from '../core/settings';
import type { DebugGui } from '../debug/DebugGui';
import { createGpuTimer, type GpuTimer } from '../debug/gpuTimer';
import { createModeStack, type ModeStack } from './ModeStack';

export interface AppOptions {
  root: HTMLElement;
  debug: boolean;
}

export interface App {
  readonly renderer: WebGLRenderer;
  readonly events: EventBus;
  readonly loop: Loop;
  readonly modes: ModeStack;
  readonly save: SaveStore;
  readonly settings: SettingsStore;
  dispose(): void;
}

declare global {
  interface Window {
    /** The running App, exposed under `?debug` for e2e tests and console poking. */
    __nonspace?: App;
  }
}

/**
 * Bootstrap: a full-window canvas driving the fixed-step loop, mode stack,
 * event bus, save and settings. The Renderer service replaces the raw
 * WebGLRenderer setup here.
 */
export async function startApp({ root, debug }: AppOptions): Promise<App> {
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = false;
  root.appendChild(renderer.domElement);

  const resize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  const events = createEventBus();
  const save = createSaveStore();
  save.load();
  const settings = createSettingsStore(save.data.settings, (s) => {
    save.data.settings = s;
    save.commit();
  });
  const modes = createModeStack({ events, settings, save });
  const loop = createLoop({
    update(dt) {
      modes.update(dt);
      events.flush();
    },
    render(alpha) {
      modes.render(alpha);
    },
  });
  // rAF stops in background tabs; don't count the hidden time as dropped.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') loop.resetClock();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (debug) {
    gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
    const { createDebugGui } = await import('../debug/DebugGui');
    gui = createDebugGui({ gpuTimerAvailable: gpuTimer !== null });
    const sim = gui.pane.addFolder({ title: 'sim' });
    const int = (v: number): string => v.toFixed(0);
    sim.addBinding(loop.stats, 'ticks', { readonly: true, format: int });
    sim.addBinding(loop.stats, 'stepsLastFrame', {
      readonly: true,
      label: 'steps/frame',
      format: int,
    });
    sim.addBinding(loop.stats, 'droppedTime', {
      readonly: true,
      label: 'dropped s',
      format: (v: number) => v.toFixed(2),
    });
  }

  let last = performance.now();
  let firstFrame = true;

  const frame = (now: number): void => {
    const dt = now - last;
    last = now;

    gpuTimer?.begin();
    renderer.clear();
    loop.frame(now);
    gpuTimer?.end();

    if (gui) gui.frame(dt, gpuTimer ? gpuTimer.poll() : null);
    if (firstFrame) {
      firstFrame = false;
      root.dataset.status = 'running';
    }
  };
  renderer.setAnimationLoop(frame);

  const app: App = {
    renderer,
    events,
    loop,
    modes,
    save,
    settings,
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      modes.reset();
      events.clear();
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (window.__nonspace === app) delete window.__nonspace;
    },
  };
  if (debug) window.__nonspace = app;
  return app;
}
