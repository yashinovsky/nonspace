import {
  FLATLINE_TIMING,
  flatlinePhaseAt,
  type FlatlinePhase,
} from '../../audio/sfx/recipes/flatline';
import type { InputFrame } from '../../input/Input';
import type { BreachController } from '../../breach/BreachController';
import { sampleCrtCollapse, type CrtCollapseState } from '../../render/fx/CrtCollapse';
import { IDENTITY_CRT_COLLAPSE } from '../../render/post/pass';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../../render/lines/BeamBatch';
import type { Mode, ModeContext } from '../ModeStack';

export { FLATLINE_TIMING, flatlinePhaseAt, type FlatlinePhase };

export interface FlatlineVisual {
  phase: FlatlinePhase;
  eegFlat: boolean;
  collapse: CrtCollapseState;
  /** 0–1 intensity of the post-silence dim green monitor line. */
  greenLine: number;
  /** 1 = CRT fully faded (black). */
  black: number;
  done: boolean;
}

/**
 * CPU twin of the §3.6 sequence, locked to `FLATLINE_TIMING` so audio and
 * picture stay on the same simulated clock.
 *
 * beeps → EEG flat; tone → CRT collapse to a dot; linger 2 s with the tone;
 * silence → black + dim green line; done → retry from checkpoint.
 */
export function sampleFlatlineVisual(elapsed: number): FlatlineVisual {
  const phase = flatlinePhaseAt(elapsed);
  const T = FLATLINE_TIMING;
  if (elapsed < 0 || phase === 'idle') {
    return {
      phase: 'idle',
      eegFlat: false,
      collapse: { ...IDENTITY_CRT_COLLAPSE },
      greenLine: 0,
      black: 0,
      done: false,
    };
  }
  const eegFlat = true;
  let collapse = { ...IDENTITY_CRT_COLLAPSE };
  let greenLine = 0;
  let black = 0;
  if (phase === 'tone') {
    collapse = sampleCrtCollapse(elapsed - T.collapseStart, T.collapseDur);
  } else if (phase === 'linger' || phase === 'silence' || phase === 'done') {
    collapse = sampleCrtCollapse(T.collapseDur, T.collapseDur);
  }
  if (phase === 'silence' || phase === 'done') {
    black = 1;
    greenLine = 0.45;
    collapse = { scaleX: 0.012, scaleY: 0.012, glow: 0, fade: 0 };
  }
  return {
    phase,
    eegFlat,
    collapse,
    greenLine,
    black,
    done: phase === 'done',
  };
}

export interface FlatlineMode extends Mode {
  readonly elapsed: number;
  readonly visual: FlatlineVisual;
  seek(time: number): void;
}

export interface FlatlineModeOptions {
  breach: BreachController;
  /** Scripted story flatlines do not add a scar (already applied by the controller). */
  scripted?: boolean;
  onDone?: () => void;
}

/**
 * Flatline mode (plan §3.6). EEG goes flat, the image collapses to a CRT dot
 * that lingers 2 s with the monitor tone, then a black screen with a dim green
 * line. On done, restore the jack-in checkpoint.
 */
export function createFlatlineMode(opts: FlatlineModeOptions): FlatlineMode {
  let ctx: ModeContext | null = null;
  let elapsed = 0;
  let visual = sampleFlatlineVisual(0);
  let finished = false;
  let line: BeamBatchGpu | null = null;

  const apply = (): void => {
    visual = sampleFlatlineVisual(elapsed);
    const renderer = ctx?.renderer;
    if (renderer) {
      const s = renderer.crtCollapse;
      s.scaleX = visual.collapse.scaleX;
      s.scaleY = visual.collapse.scaleY;
      s.glow = visual.collapse.glow;
      s.fade = visual.collapse.fade;
    }
    if (line) {
      line.object.visible = visual.greenLine > 0.01;
      if (line.object.visible && renderer) {
        const w = renderer.cssWidth;
        const y = renderer.cssHeight * 0.5;
        line.beginDynamic();
        line.push(
          { x: w * 0.12, y, z: -1 },
          { x: w * 0.88, y, z: -1 },
          Beam.AFTERGLOW,
          visual.greenLine,
          1.8,
          BeamFlag.NO_FOG | BeamFlag.DWELL,
        );
        line.endDynamic();
      }
    }
    const hudKids = renderer?.scenes.hud.children;
    if (hudKids) {
      for (const child of hudKids) {
        if (child === line?.object) continue;
        child.visible = visual.greenLine < 0.01;
      }
    }
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    elapsed = FLATLINE_TIMING.total;
    visual = sampleFlatlineVisual(elapsed);
    opts.breach.restoreCheckpoint();
    opts.onDone?.();
  };

  const mode: FlatlineMode = {
    id: 'flatline',
    simulatesWhenCovered: false,
    get elapsed() {
      return elapsed;
    },
    get visual() {
      return visual;
    },
    seek(time) {
      elapsed = Math.max(0, time);
      apply();
      if (visual.done) finish();
    },
    enter(next) {
      ctx = next;
      finished = false;
      elapsed = 0;
      const renderer = next.renderer;
      if (renderer) {
        renderer.postMode = 'matrix';
        line = createBeamBatch(renderer.palette, {
          capacity: 2,
          style: { fogDensity: 0, fogStart: 1e9, sigma: 0.7, dwell: 0.4, dwellSigma: 2 },
        });
        line.object.name = 'FlatlineGreen';
        line.material.depthTest = false;
        renderer.scenes.hud.add(line.object);
      }
      apply();
    },
    exit() {
      const renderer = ctx?.renderer;
      if (line && renderer) renderer.scenes.hud.remove(line.object);
      line?.dispose();
      line = null;
      if (renderer) {
        for (const child of renderer.scenes.hud.children) child.visible = true;
        const s = renderer.crtCollapse;
        s.scaleX = IDENTITY_CRT_COLLAPSE.scaleX;
        s.scaleY = IDENTITY_CRT_COLLAPSE.scaleY;
        s.glow = IDENTITY_CRT_COLLAPSE.glow;
        s.fade = IDENTITY_CRT_COLLAPSE.fade;
      }
      ctx = null;
    },
    update(dt) {
      if (finished) return;
      elapsed += Math.max(0, dt);
      apply();
      if (visual.done) finish();
    },
    render() {
      apply();
    },
    handleInput(_frame: InputFrame) {
      // Sequence is not skippable.
    },
  };
  return mode;
}
