import type { AudioEngine } from '../audio/AudioEngine';
import {
  PHASE_LOCK_F0,
  syncPhaseLockEngine,
  telegraphProgress,
  type PhaseLockDriveInput,
  type PhaseLockSession,
} from '../audio/phaseLock';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import { createHeat, type Heat } from '../deck/Heat';
import { createNeuralLoad, type NeuralLoad } from '../deck/NeuralLoad';
import { createTrace, HULL_TRACE_RATE, type Trace } from '../deck/Trace';
import type { InputFrame } from '../input/Input';
import type { Vec3 } from '../core/math/vec3';
import { clampLnR, knobToR, wrapPositive } from './PhaseLock';
import { createGrip, GRIP_SECONDS, type Grip, type GripReason } from './Grip';
import {
  createIceModel,
  type IceDef,
  type IceModel,
  type IceSimEvent,
  type IceSoftMods,
} from './IceModel';

/** Engage ICE when facing a facet within this many world units (plan §3.9). */
export const ENGAGE_RANGE = 60;
/** Minimum look · ice-direction to count as facing a facet. */
export const ENGAGE_FACING_DOT = 0.2;
/** Jack-out hold (plan §3.9). */
export const JACK_OUT_HOLD = 1;
/** Prototype / §3.9 knob scales. Shift (`fineAdjust`) multiplies by FINE. */
export const KNOB_MOUSE_LN = 0.0022;
export const KNOB_MOUSE_PHI = 0.008;
export const KNOB_STICK_LN_PER_S = 0.5;
export const KNOB_STICK_PHI_PER_S = 2.2;
export const KNOB_FINE = 0.15;

export interface IceAnchor {
  def: IceDef;
  x: number;
  y: number;
  z: number;
  seed?: number;
}

export interface BreachKnobs {
  lnR: number;
  Phi: number;
  R: number;
}

export interface BreachCheckpoint {
  neural: number;
  trace: number;
}

export type BreachOutcome =
  | { kind: 'none' }
  | { kind: 'cracked'; iceId: string }
  | { kind: 'flatline'; scripted: boolean }
  | { kind: 'burned' };

export interface KnobInput {
  mouseDx: number;
  mouseDy: number;
  knobX: number;
  knobY: number;
}

export function distanceToIce(player: Vec3, ice: Vec3): number {
  return Math.hypot(ice.x - player.x, ice.y - player.y, ice.z - player.z);
}

/** True when the look vector points at the ICE (a facet faces the cowboy). */
export function facingFacet(
  player: Vec3,
  forward: Vec3,
  ice: Vec3,
  minDot = ENGAGE_FACING_DOT,
): boolean {
  const dx = ice.x - player.x;
  const dy = ice.y - player.y;
  const dz = ice.z - player.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  return (forward.x * dx + forward.y * dy + forward.z * dz) / dist >= minDot;
}

export function canEngageFrom(
  player: Vec3,
  forward: Vec3,
  ice: Vec3,
  range = ENGAGE_RANGE,
): boolean {
  return distanceToIce(player, ice) <= range && facingFacet(player, forward, ice);
}

export function stepKnobs(
  lnR: number,
  Phi: number,
  input: KnobInput,
  dt: number,
  fine: boolean,
): { lnR: number; Phi: number } {
  const f = fine ? KNOB_FINE : 1;
  return {
    lnR: clampLnR(
      lnR + input.mouseDx * KNOB_MOUSE_LN * f + input.knobX * KNOB_STICK_LN_PER_S * f * dt,
    ),
    Phi: wrapPositive(
      Phi + input.mouseDy * KNOB_MOUSE_PHI * f + input.knobY * KNOB_STICK_PHI_PER_S * f * dt,
    ),
  };
}

export interface BreachStepOpts {
  /** ICE hull contact while not engaged (plan §3.3). */
  iceContact?: boolean;
  /** M4.4: mutate knobs after player input, before IceModel.step (MIMIC). */
  afterKnobs?: (knobs: BreachKnobs, ice: IceModel, dt: number) => void;
  /** M4.4: CLAMP / DAMPER / DECOY multipliers for this step. */
  iceMods?: IceSoftMods;
}

export interface BreachController {
  readonly neural: NeuralLoad;
  readonly trace: Trace;
  readonly heat: Heat;
  readonly grip: Grip;
  readonly ice: IceModel | null;
  readonly anchor: IceAnchor | null;
  readonly engaged: boolean;
  readonly knobs: BreachKnobs;
  readonly lastOutcome: BreachOutcome;
  readonly jackOutBlocked: boolean;
  canEngage(player: Vec3, forward: Vec3, ice: IceAnchor): boolean;
  tryEngage(player: Vec3, forward: Vec3, ice: IceAnchor): boolean;
  /** Engage without the range check (lab / cracked-layer continue). */
  engage(ice: IceAnchor, layer?: number): void;
  disengage(): void;
  canJackOut(): boolean;
  /** True if the 1 s hold is satisfied and grip is not holding. */
  jackOutReady(heldSeconds: number): boolean;
  step(dt: number, input: InputFrame, opts?: BreachStepOpts): BreachOutcome;
  forceGrip(reason?: GripReason): void;
  forceFlatline(scripted?: boolean): BreachOutcome;
  forceBurned(): BreachOutcome;
  markCheckpoint(): void;
  restoreCheckpoint(): void;
  setPurist(on: boolean): void;
  /** M5.4: attach/replace the §9.7 engine. Null stops the bed. */
  setAudio(next: AudioEngine | undefined): void;
}

export interface BreachControllerOptions {
  events?: EventBus;
  save?: SaveStore;
  neural?: NeuralLoad;
  trace?: Trace;
  heat?: Heat;
  purist?: boolean;
  /** Optional §9.7 engine. Phase Lock math is unchanged; this only drives tones. */
  audio?: AudioEngine;
  /** Mission-key f0 in Hz (default A2 = 110). */
  f0?: number;
}

function emptyKnobs(): BreachKnobs {
  return { lnR: 0, Phi: 0, R: 1 };
}

/**
 * Breach orchestrator (M4.3): engage/disengage, Phase Lock knobs, deck meters,
 * grip countdown, flatline and burned. Phase Lock math stays in `PhaseLock.ts`.
 */
export function createBreachController(opts: BreachControllerOptions = {}): BreachController {
  const events = opts.events;
  const save = opts.save;
  const neural = opts.neural ?? createNeuralLoad({ events, scars: save?.data.campaign.scars ?? 0 });
  const trace = opts.trace ?? createTrace({ events });
  const heat = opts.heat ?? createHeat({ save });
  const grip = createGrip();
  const knobs = emptyKnobs();
  let purist = opts.purist ?? false;
  let ice: IceModel | null = null;
  let anchor: IceAnchor | null = null;
  let lastOutcome: BreachOutcome = { kind: 'none' };
  let checkpoint: BreachCheckpoint = { neural: neural.value, trace: trace.value };
  let flatlineEmitted = false;
  let audio = opts.audio;
  const f0 = opts.f0 ?? PHASE_LOCK_F0;
  const plSession: PhaseLockSession = { started: false, music: null };

  const driveInput = (): PhaseLockDriveInput | null => {
    if (!ice || ice.state.status !== 'engaged') return null;
    const cur = ice.state.current;
    const [a, b] = cur.ratio;
    const tel = cur.telegraph;
    return {
      engaged: true,
      a,
      b,
      phi: cur.phi,
      R: knobs.R,
      Phi: knobs.Phi + cur.roll,
      telegraph: tel
        ? {
            nextA: tel.next[0],
            nextB: tel.next[1],
            k: telegraphProgress(ice.state.t, tel.start, tel.end),
          }
        : null,
      grip: grip.active,
      meter: cur.meter,
    };
  };

  const syncAudio = (): void => {
    if (!audio) return;
    syncPhaseLockEngine(audio, plSession, driveInput(), f0);
  };

  const syncKnobs = (): void => {
    knobs.R = knobToR(knobs.lnR, purist);
  };

  const applyIceMeters = (): void => {
    if (!ice) return;
    if (ice.state.neural > neural.max) ice.state.neural = neural.max;
    if (ice.state.trace > 100) ice.state.trace = 100;
    neural.set(ice.state.neural);
    trace.set(ice.state.trace);
  };

  const finishGrip = (): void => {
    grip.end();
  };

  const emitFlatline = (scripted: boolean): BreachOutcome => {
    if (!scripted) {
      neural.addScar();
      if (save) {
        save.data.campaign.scars = neural.scars;
        save.data.campaign.flatlines = (save.data.campaign.flatlines ?? 0) + 1;
        save.commit();
      }
    }
    ice?.disengage();
    finishGrip();
    ice = null;
    anchor = null;
    syncAudio();
    const out: BreachOutcome = { kind: 'flatline', scripted };
    lastOutcome = out;
    if (!flatlineEmitted) {
      flatlineEmitted = true;
      events?.post({ type: 'flatline', scripted });
    }
    return out;
  };

  const emitBurned = (): BreachOutcome => {
    ice?.disengage();
    finishGrip();
    ice = null;
    anchor = null;
    syncAudio();
    heat.applyRunEnd(trace.value, true);
    const out: BreachOutcome = { kind: 'burned' };
    lastOutcome = out;
    events?.post({ type: 'jackOut', reason: 'burned' });
    return out;
  };

  const handleIceEvents = (list: IceSimEvent[]): BreachOutcome => {
    let cracked: BreachOutcome = { kind: 'none' };
    for (const e of list) {
      if (e.type === 'gripStart' && ice) {
        const secs = ice.def.layers[ice.state.current.index]?.grip?.seconds ?? GRIP_SECONDS;
        const reason = ice.state.grip?.reason ?? 'neural';
        grip.start(e.iceId, secs, reason);
      } else if (e.type === 'gripEnd') {
        finishGrip();
      } else if (e.type === 'iceLayerCracked' && ice?.state.status === 'cracked') {
        cracked = { kind: 'cracked', iceId: e.iceId };
      }
    }
    return cracked;
  };

  const api: BreachController = {
    neural,
    trace,
    heat,
    grip,
    get ice() {
      return ice;
    },
    get anchor() {
      return anchor;
    },
    get engaged() {
      return ice?.state.status === 'engaged';
    },
    get knobs() {
      return knobs;
    },
    get lastOutcome() {
      return lastOutcome;
    },
    get jackOutBlocked() {
      return grip.jackOutBlocked;
    },
    canEngage(player, forward, next) {
      return canEngageFrom(player, forward, next);
    },
    tryEngage(player, forward, next) {
      if (!api.canEngage(player, forward, next)) return false;
      api.engage(next);
      return true;
    },
    engage(next, layer = 0) {
      ice?.disengage();
      finishGrip();
      flatlineEmitted = false;
      lastOutcome = { kind: 'none' };
      anchor = next;
      ice = createIceModel(next.def, {
        seed: next.seed,
        events,
        neural: neural.value,
        trace: trace.value,
      });
      ice.engage(layer);
      knobs.lnR = 0;
      knobs.Phi = 0;
      syncKnobs();
      syncAudio();
    },
    disengage() {
      ice?.disengage();
      finishGrip();
      ice = null;
      anchor = null;
      syncAudio();
    },
    canJackOut() {
      return !grip.jackOutBlocked;
    },
    jackOutReady(heldSeconds) {
      return api.canJackOut() && heldSeconds >= JACK_OUT_HOLD;
    },
    step(dt, input, stepOpts) {
      lastOutcome = { kind: 'none' };
      const engaged = ice?.state.status === 'engaged';
      if (engaged && ice) {
        const moved = stepKnobs(knobs.lnR, knobs.Phi, input, dt, input.down('fineAdjust'));
        knobs.lnR = moved.lnR;
        knobs.Phi = moved.Phi;
        syncKnobs();
        stepOpts?.afterKnobs?.(knobs, ice, dt);
        syncKnobs();
        const ev = ice.step(dt, {
          R: knobs.R,
          Phi: knobs.Phi,
          freezeDrift: stepOpts?.iceMods?.freezeDrift,
          feedbackMul: stepOpts?.iceMods?.feedbackMul,
          traceMul: stepOpts?.iceMods?.traceMul,
        });
        applyIceMeters();
        const cracked = handleIceEvents(ev);
        const gripTick = grip.step(dt);
        if (cracked.kind === 'cracked') {
          api.disengage();
          lastOutcome = cracked;
          return cracked;
        }
        if (gripTick === 'timeout' || neural.flatlined) {
          return emitFlatline(false);
        }
        if (trace.burned) return emitBurned();
        syncAudio();
        return lastOutcome;
      }

      neural.step(dt, false);
      if (stepOpts?.iceContact) trace.step(dt, HULL_TRACE_RATE);
      if (neural.flatlined) return emitFlatline(false);
      if (trace.burned) return emitBurned();
      return lastOutcome;
    },
    forceGrip(reason = 'neural') {
      if (!ice || ice.state.status !== 'engaged') return;
      const ev = ice.forceGrip(reason);
      handleIceEvents(ev);
      syncAudio();
    },
    forceFlatline(scripted = false) {
      return emitFlatline(scripted);
    },
    forceBurned() {
      trace.set(100);
      return emitBurned();
    },
    markCheckpoint() {
      checkpoint = { neural: neural.value, trace: trace.value };
    },
    restoreCheckpoint() {
      neural.reset(checkpoint.neural);
      trace.reset(checkpoint.trace);
      finishGrip();
      ice = null;
      anchor = null;
      flatlineEmitted = false;
      lastOutcome = { kind: 'none' };
      syncAudio();
    },
    setAudio(next) {
      if (audio && audio !== next && plSession.started) audio.phaseLock.stop();
      audio = next;
      plSession.started = false;
      plSession.music = null;
      syncAudio();
    },
    setPurist(on) {
      purist = on;
      syncKnobs();
    },
  };
  syncKnobs();
  return api;
}
