import type { BreachController } from '../../breach/BreachController';
import { JACK_OUT_HOLD } from '../../breach/BreachController';
import type { IceVisuals } from '../../breach/IceVisuals';
import type { Hud } from '../../hud/Hud';
import type { InputFrame } from '../../input/Input';
import type { Camera } from 'three';
import type { Mode, ModeContext } from '../ModeStack';

export interface BreachMode extends Mode {
  readonly breach: BreachController;
}

export interface BreachModeOptions {
  breach: BreachController;
  hud?: Hud;
  visuals?: IceVisuals | null;
  camera?: Camera;
  reduceMotion?: () => boolean;
  onCracked?: (iceId: string) => void;
  onFlatline?: (scripted: boolean) => void;
  onBurned?: () => void;
  onJackOut?: () => void;
}

/**
 * In-matrix Phase Lock (plan §3.5 / §3.9). Flight is parked. Knobs are mouse
 * X/Y (ratio / phase) and sticks; Shift is fine adjust. Grip blocks jack-out.
 */
export function createBreachMode(opts: BreachModeOptions): BreachMode {
  const { breach } = opts;
  let ctx: ModeContext | null = null;

  const paintHud = (): void => {
    const hud = opts.hud;
    if (!hud) return;
    const ice = breach.ice;
    const cur = ice?.state.current;
    hud.setNeural(breach.neural.value);
    hud.setTrace(breach.trace.value);
    hud.setFlatline(false);
    hud.setScars(breach.neural.scars);
    if (breach.grip.active) {
      hud.setMode('GRIP');
      hud.setGrip(breach.grip.remaining);
    } else {
      hud.setMode('BREACH');
      hud.setGrip(null);
    }
    if (cur) {
      const [a, b] = cur.ratio;
      hud.setLock({
        meter: cur.meter,
        m: cur.m,
        lnR: Math.log(breach.knobs.R),
        targetLnR: Math.log(b / a),
        Phi: breach.knobs.Phi,
        phi: cur.phi,
        telegraph: cur.telegraph !== null,
      });
    } else {
      hud.setLock(null);
    }
  };

  const mode: BreachMode = {
    id: 'breach',
    simulatesWhenCovered: true,
    breach,
    enter(next) {
      ctx = next;
      if (next.audio) breach.setAudio(next.audio);
      paintHud();
    },
    exit() {
      opts.hud?.setLock(null);
      opts.hud?.setGrip(null);
      ctx = null;
    },
    update(dt) {
      const cam = opts.camera ?? ctx?.renderer?.cameras.matrix;
      if (opts.visuals && breach.ice && cam) {
        opts.visuals.update(dt, breach.ice, cam, opts.reduceMotion?.() ?? false);
      }
      paintHud();
      opts.hud?.update(0);
    },
    render() {
      paintHud();
    },
    handleInput(frame: InputFrame) {
      const out = breach.step(frame.dt || 0, frame);
      if (out.kind === 'cracked') {
        opts.onCracked?.(out.iceId);
        return;
      }
      if (out.kind === 'flatline') {
        opts.onFlatline?.(out.scripted);
        return;
      }
      if (out.kind === 'burned') {
        opts.onBurned?.();
        return;
      }
      if (breach.grip.active) {
        if (frame.pressed('jackOut') || frame.down('jackOut')) {
          opts.hud?.print("DECK WON'T LET GO");
        }
        return;
      }
      if (frame.held('jackOut') >= JACK_OUT_HOLD) opts.onJackOut?.();
    },
  };
  return mode;
}
