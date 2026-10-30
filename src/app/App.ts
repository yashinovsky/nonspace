import { WebGLRenderer } from 'three';
import type { DebugGui } from '../debug/DebugGui';
import { createGpuTimer, type GpuTimer } from '../debug/gpuTimer';

export interface AppOptions {
  root: HTMLElement;
  debug: boolean;
}

export interface App {
  readonly renderer: WebGLRenderer;
  dispose(): void;
}

/**
 * M0.1 bootstrap: a black full-window canvas and a frame loop. The fixed-step
 * loop (core/loop.ts), ModeStack and Renderer service replace the internals.
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

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (debug) {
    gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
    const { createDebugGui } = await import('../debug/DebugGui');
    gui = createDebugGui({ gpuTimerAvailable: gpuTimer !== null });
  }

  let last = performance.now();
  let firstFrame = true;

  const frame = (now: number): void => {
    const dt = now - last;
    last = now;

    gpuTimer?.begin();
    renderer.clear();
    gpuTimer?.end();

    if (gui) gui.frame(dt, gpuTimer ? gpuTimer.poll() : null);
    if (firstFrame) {
      firstFrame = false;
      root.dataset.status = 'running';
    }
  };
  renderer.setAnimationLoop(frame);

  return {
    renderer,
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
