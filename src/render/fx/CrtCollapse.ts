import type { Renderer } from '../Renderer';
import { IDENTITY_CRT_COLLAPSE, type CrtCollapseState } from '../post/pass';

/** Jack-out CRT power-off (plan §5.9). Image → line → dot → black in 0.6 s. */
export const CRT_COLLAPSE_DURATION = 0.6;

export type { CrtCollapseState };
export { IDENTITY_CRT_COLLAPSE };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * 0.6 s analog power-off: squash Y to a phosphor line, then X to a dot,
 * then the dot fades. 1984 CRT, not a glitch wipe. Low large-area contrast.
 */
export function sampleCrtCollapse(
  elapsed: number,
  duration = CRT_COLLAPSE_DURATION,
): CrtCollapseState {
  if (elapsed < 0) return { ...IDENTITY_CRT_COLLAPSE };
  if (elapsed >= duration || duration <= 0) {
    return { scaleX: 0.012, scaleY: 0.012, glow: 0, fade: 0 };
  }
  const u = elapsed / duration;
  const scaleY = 1 - smoothstep(0, 0.46, u) * 0.988;
  const scaleX = 1 - smoothstep(0.38, 0.72, u) * 0.988;
  const glow = smoothstep(0.12, 0.42, u) * (1 - smoothstep(0.62, 1, u)) * 0.55;
  const fade = 1 - smoothstep(0.7, 1, u);
  return { scaleX, scaleY, glow, fade };
}

/** Approximate whole-frame mean luma for the §5.9 flash audit (large area). */
export function crtCollapseLuma(state: CrtCollapseState): number {
  const area = Math.max(state.scaleX, 0.012) * Math.max(state.scaleY, 0.012);
  return (0.42 * area + 0.07 * state.glow) * state.fade;
}

export function sampleCrtCollapseLuma(duration = CRT_COLLAPSE_DURATION, fps = 60): number[] {
  const n = Math.max(1, Math.round(duration * fps));
  const dt = 1 / fps;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(crtCollapseLuma(sampleCrtCollapse(i * dt, duration)));
  return out;
}

export interface CrtCollapse {
  readonly duration: number;
  time: number;
  readonly done: boolean;
  readonly playing: boolean;
  readonly sample: CrtCollapseState;
  play(): void;
  stop(): void;
  seek(time: number): void;
  update(dt: number): void;
  apply(renderer: Renderer): void;
  dispose(): void;
}

export function createCrtCollapse(duration = CRT_COLLAPSE_DURATION): CrtCollapse {
  let time = 0;
  let playing = false;
  let sample = { ...IDENTITY_CRT_COLLAPSE };

  const sync = (): void => {
    sample = playing ? sampleCrtCollapse(time, duration) : { ...IDENTITY_CRT_COLLAPSE };
  };

  const api: CrtCollapse = {
    duration,
    get time() {
      return time;
    },
    set time(v) {
      api.seek(v);
    },
    get done() {
      return playing && time >= duration;
    },
    get playing() {
      return playing;
    },
    get sample() {
      return sample;
    },
    play() {
      playing = true;
      time = 0;
      sync();
    },
    stop() {
      playing = false;
      time = 0;
      sample = { ...IDENTITY_CRT_COLLAPSE };
    },
    seek(next) {
      time = Math.max(0, next);
      if (playing) sync();
    },
    update(dt) {
      if (!playing || !(dt > 0)) return;
      time += dt;
      sync();
    },
    apply(renderer) {
      const s = renderer.crtCollapse;
      s.scaleX = sample.scaleX;
      s.scaleY = sample.scaleY;
      s.glow = sample.glow;
      s.fade = sample.fade;
    },
    dispose() {
      api.stop();
    },
  };
  return api;
}
