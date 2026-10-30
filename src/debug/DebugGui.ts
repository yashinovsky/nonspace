import { Pane } from 'tweakpane';

export interface DebugGui {
  readonly pane: Pane;
  /** Call once per rendered frame. */
  frame(dtMs: number, gpuMs: number | null): void;
  dispose(): void;
}

export interface DebugGuiOptions {
  gpuTimerAvailable: boolean;
  container?: HTMLElement;
}

export function createDebugGui(opts: DebugGuiOptions): DebugGui {
  const pane = new Pane({ title: 'NONSPACE debug', container: opts.container });
  pane.element.parentElement?.setAttribute('data-testid', 'debug-gui');

  const stats = {
    fps: 0,
    frameMs: 0,
    gpuMs: opts.gpuTimerAvailable ? 'pending' : 'n/a (no timer ext)',
  };
  let avgDt = 1000 / 60;

  const perf = pane.addFolder({ title: 'perf' });
  perf.addBinding(stats, 'fps', { readonly: true, format: (v: number) => v.toFixed(1) });
  perf.addBinding(stats, 'fps', { readonly: true, view: 'graph', min: 0, max: 144, label: '' });
  perf.addBinding(stats, 'frameMs', {
    readonly: true,
    label: 'frame ms',
    format: (v: number) => v.toFixed(2),
  });
  perf.addBinding(stats, 'gpuMs', { readonly: true, label: 'gpu ms' });

  return {
    pane,
    frame(dtMs, gpuMs) {
      avgDt += (dtMs - avgDt) * 0.1;
      stats.frameMs = avgDt;
      stats.fps = avgDt > 0 ? 1000 / avgDt : 0;
      if (gpuMs !== null) stats.gpuMs = gpuMs.toFixed(2);
    },
    dispose() {
      pane.dispose();
    },
  };
}
