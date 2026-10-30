/**
 * Fixed-step simulation with variable-rate rendering (plan §8.2). Feed it the
 * frame timestamp from requestAnimationFrame; it runs `update(SIM_DT)` as many
 * times as wall time requires, then `render(alpha)` once with the fraction of
 * a step left over for interpolation. The sim never sees a variable dt.
 *
 * Long frames (throttled CPU, a backgrounded tab) are clamped to
 * `maxFrameTime`, so the sim slows down instead of spiralling; the time thrown
 * away is reported in `stats.droppedTime`.
 */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Absorbs float error when wall time lands exactly on a step boundary. */
const EPSILON = 1e-9;

export interface LoopOptions {
  /** Called with a constant dt (seconds) for every sim step. */
  update(dt: number): void;
  /** Called once per frame. `alpha` in [0, 1) is the progress toward the next sim step. */
  render(alpha: number, frameDt: number): void;
  /** Sim step in seconds. Default `SIM_DT`. */
  step?: number;
  /** Longest wall-clock frame (seconds) the sim catches up on. Default 0.25 (15 steps). */
  maxFrameTime?: number;
}

export interface LoopStats {
  /** Sim steps run since creation. */
  ticks: number;
  /** Simulated seconds: `ticks * step`. */
  simTime: number;
  /** Frames rendered. */
  frames: number;
  /** Sim steps run in the last frame. */
  stepsLastFrame: number;
  /** Most sim steps run in a single frame. */
  maxStepsPerFrame: number;
  /** Wall seconds discarded by the `maxFrameTime` clamp or while paused. */
  droppedTime: number;
  /** Interpolation alpha passed to the last render. */
  alpha: number;
}

export interface Loop {
  readonly step: number;
  readonly stats: Readonly<LoopStats>;
  /** While paused, frames still render (with a frozen alpha) but the sim does not advance. */
  paused: boolean;
  /** Advance to wall time `nowMs` (e.g. the rAF timestamp), running sim steps and one render. */
  frame(nowMs: number): void;
  /** Forget the last timestamp so the next frame counts as zero elapsed time. */
  resetClock(): void;
}

export function createLoop(opts: LoopOptions): Loop {
  const step = opts.step ?? SIM_DT;
  const maxFrameTime = opts.maxFrameTime ?? 0.25;
  if (!(step > 0)) throw new RangeError(`loop step must be > 0, got ${step}`);
  if (!(maxFrameTime >= step)) throw new RangeError('loop maxFrameTime must be >= step');

  const stats: LoopStats = {
    ticks: 0,
    simTime: 0,
    frames: 0,
    stepsLastFrame: 0,
    maxStepsPerFrame: 0,
    droppedTime: 0,
    alpha: 0,
  };
  let lastMs = -1;
  let acc = 0;

  const loop: Loop = {
    step,
    stats,
    paused: false,
    frame(nowMs) {
      let frameDt = lastMs < 0 ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      if (!(frameDt > 0)) frameDt = 0;

      let steps = 0;
      if (loop.paused) {
        stats.droppedTime += frameDt;
      } else {
        let dt = frameDt;
        if (dt > maxFrameTime) {
          stats.droppedTime += dt - maxFrameTime;
          dt = maxFrameTime;
        }
        acc += dt;
        while (acc >= step - EPSILON) {
          acc -= step;
          steps++;
          stats.ticks++;
          stats.simTime = stats.ticks * step;
          opts.update(step);
        }
        if (acc < 0) acc = 0;
      }

      stats.stepsLastFrame = steps;
      if (steps > stats.maxStepsPerFrame) stats.maxStepsPerFrame = steps;
      stats.alpha = acc / step;
      stats.frames++;
      opts.render(stats.alpha, frameDt);
    },
    resetClock() {
      lastMs = -1;
    },
  };
  return loop;
}
