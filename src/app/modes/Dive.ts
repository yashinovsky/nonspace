import type { PerspectiveCamera } from 'three';
import { iceAssistMods } from '../../a11y/assists';
import type { AudioEngine } from '../../audio/AudioEngine';
import { stepKnobs } from '../../breach/BreachController';
import { createIceModel, type IceModel } from '../../breach/IceModel';
import { knobToR } from '../../breach/PhaseLock';
import { TA_ICE } from '../../content/ice/ta';
import type { Hud } from '../../hud/Hud';
import type { InputFrame } from '../../input/Input';
import { clearGate, gateZ, DIVE_GATE_WINDOW, stepDive, type DiveState } from '../../world/diveMath';
import type { DiveTube } from '../../world/DiveTube';
import type { Kuang } from '../../world/Kuang';
import type { Mode, ModeContext } from '../ModeStack';

export interface DiveMode extends Mode {
  readonly state: DiveState;
  readonly ice: IceModel;
  readonly knobs: { lnR: number; Phi: number; R: number };
  paint(): void;
  enterGate(): void;
  forceCrack(): void;
}

export interface DiveModeOptions {
  state: DiveState;
  tube: DiveTube;
  kuang: Kuang;
  hud?: Hud;
  audio?: AudioEngine;
  camera?: PerspectiveCamera;
  ice?: IceModel;
  reduceMotion?: () => boolean;
  onHit?: () => void;
  onGate?: (segment: number) => void;
  onGateClear?: (segment: number) => void;
  onDone?: () => void;
}

function paintLock(hud: Hud | undefined, ice: IceModel, lnR: number, Phi: number): void {
  if (!hud) return;
  const cur = ice.state.current;
  const [a, b] = cur.ratio;
  hud.setLock({
    meter: cur.meter,
    m: cur.m,
    lnR,
    targetLnR: Math.log(b / a),
    Phi,
    phi: cur.phi,
    telegraph: cur.telegraph !== null,
  });
}

/**
 * Tube dive (plan §4.4 M5 Phase C). Camera rides the axis at constant speed.
 * Strafe is discrete lanes; gates reuse IceModel + PhaseLock with kuang-gate
 * tolerance (`KUANG_GATE_TOL`).
 */
export function createDiveMode(opts: DiveModeOptions): DiveMode {
  const { state, tube, kuang } = opts;
  const ice = opts.ice ?? createIceModel(TA_ICE, { seed: 11 });
  const knobs = { lnR: 0, Phi: 0, R: 1 };
  knobs.R = knobToR(knobs.lnR);
  let ctx: ModeContext | null = null;
  let musicOn = false;
  let lockLive = false;

  const camera = (): PerspectiveCamera | undefined =>
    opts.camera ?? (ctx?.renderer?.cameras.matrix as PerspectiveCamera | undefined);

  const frameCamera = (): void => {
    const cam = camera();
    if (!cam) return;
    cam.position.set(0, 0, state.z + 4.5);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, state.z - 28);
    cam.near = 0.35;
    cam.far = 280;
    cam.updateProjectionMatrix();
  };

  const paintHud = (): void => {
    const hud = opts.hud;
    if (!hud) return;
    hud.setSpeed(state.speed);
    hud.setFlatline(false);
    hud.setGrip(null);
    hud.setNeural(Math.min(100, state.hits * 8));
    if (state.phase === 'gate') {
      hud.setMode('BREACH');
      paintLock(hud, ice, knobs.lnR, knobs.Phi);
    } else {
      hud.setMode(state.phase === 'done' ? 'CORE' : 'DIVE');
      hud.setLock(null);
    }
    hud.setBlips([{ angle: 5.5, radius: 0.42, kind: 'kuang' }]);
  };

  const startLock = (): void => {
    ice.engage(0);
    const [a, b] = ice.state.current.ratio;
    knobs.lnR = Math.log(b / a) + 0.08;
    knobs.Phi = ice.state.current.phi + 0.4;
    knobs.R = knobToR(knobs.lnR);
    opts.audio?.phaseLock.start(a, b, 130);
    opts.audio?.phaseLock.setTarget(a, b, ice.state.current.phi);
    lockLive = true;
    opts.onGate?.(state.segment);
  };

  const stopLock = (): void => {
    if (lockLive) opts.audio?.phaseLock.stop();
    lockLive = false;
  };

  const paintWorld = (): void => {
    kuang.pose = 'coil';
    kuang.coilZ = state.z - 2;
    kuang.coilRadius = state.radius * 1.18;
    kuang.coilLength = 32;
    kuang.mimic = Math.min(1, 0.35 + state.gatesCleared * 0.22);
    kuang.paint();
    tube.paint(state, state.phase === 'gate' ? ice : null, knobs);
    frameCamera();
    paintHud();
  };

  const mode: DiveMode = {
    id: 'dive',
    simulatesWhenCovered: true,
    state,
    ice,
    knobs,
    enter(next) {
      ctx = next;
      if (!musicOn) {
        opts.audio?.music.setState('kuangDive');
        musicOn = true;
      }
      paintWorld();
      opts.hud?.update(0);
    },
    exit() {
      stopLock();
      opts.hud?.setLock(null);
      ctx = null;
    },
    update(dt) {
      kuang.update(dt, opts.reduceMotion?.() ?? false);
      paintWorld();
      opts.hud?.update(0);
    },
    render() {
      paintHud();
    },
    paint: paintWorld,
    enterGate() {
      state.z = gateZ(state.segment) + DIVE_GATE_WINDOW;
      state.phase = 'gate';
      startLock();
      paintWorld();
    },
    forceCrack() {
      ice.crack();
      const seg = state.segment;
      stopLock();
      const next = clearGate(state);
      opts.onGateClear?.(seg);
      if (next === 'done') opts.onDone?.();
      paintWorld();
    },
    handleInput(frame: InputFrame) {
      const dt = frame.dt || 0;
      if (state.phase === 'gate') {
        const next = stepKnobs(knobs.lnR, knobs.Phi, frame, dt, frame.down('fineAdjust'));
        knobs.lnR = next.lnR;
        knobs.Phi = next.Phi;
        knobs.R = knobToR(knobs.lnR);
        const pl = ctx?.settings.value.phaseLock;
        const evs = ice.step(dt, {
          R: knobs.R,
          Phi: knobs.Phi,
          ...(pl ? iceAssistMods(pl) : {}),
        });
        const [a, b] = ice.state.current.ratio;
        opts.audio?.phaseLock.setPlayer(knobs.R, knobs.Phi);
        opts.audio?.phaseLock.setTarget(a, b, ice.state.current.phi);
        if (evs.some((e) => e.type === 'iceLayerCracked') || ice.state.status === 'cracked') {
          const seg = state.segment;
          stopLock();
          opts.audio?.sfx('kuangSting');
          const after = clearGate(state);
          opts.onGateClear?.(seg);
          if (after === 'done') opts.onDone?.();
        }
        paintWorld();
        return;
      }
      const out = stepDive(state, { strafe: frame.strafe, dt });
      if (out.hit) {
        opts.audio?.sfx('kuangSting');
        opts.onHit?.();
      }
      if (out.enteredGate) startLock();
      if (out.finished) opts.onDone?.();
      paintWorld();
    },
  };
  return mode;
}
