import type { EventBus } from '../core/events';
import { Pcg32 } from '../core/rng';
import type { Beam } from '../render/lines/BeamBatch';
import {
  DISSONANCE_THRESHOLD,
  TAU,
  matchMetric,
  rekeyMeterReset,
  stepLockMeter,
  stepRoll,
  wrapPositive,
} from './PhaseLock';

/** ICE definitions (plan §9.3). Runtime: layers, drift, re-key scheduler, grip (M4.2). */
export type IceClass = 'white' | 'gray' | 'black' | 'ta';

export interface IceLayerDef {
  /** Allowed a:b ratios. */
  ratios: Array<[number, number]>;
  /** Ratio tolerance in log units, e.g. 0.06. */
  tolRatio: number;
  /** rad/s */
  phaseDrift: number;
  /** Seconds, random in range; undefined = never re-keys. */
  rekeyEvery?: [number, number];
  /** Seconds of warning before a re-key. */
  telegraph: number;
  /** Seconds at m >= LOCK_THRESHOLD to crack. */
  lockTime: number;
  /** Trace %/s while engaged. */
  traceRate: number;
  /** Neural load/s while m < DISSONANCE_THRESHOLD. */
  feedbackDps: number;
  grip?: { neuralThreshold: number; seconds: number };
}

export interface IceDef {
  id: string;
  class: IceClass;
  shell: 'cube' | 'octa' | 'icosa' | 'slab';
  radius: number;
  layers: IceLayerDef[];
  hue: Beam;
}

export type IceStatus = 'idle' | 'engaged' | 'cracked';

export type Ratio = readonly [number, number];

/** Probability that a re-key changes the ratio (otherwise it only jumps phase). */
export const REKEY_RATIO_CHANGE_P = 0.65;

export interface RekeyTelegraph {
  start: number;
  end: number;
  next: Ratio;
  /** Added to the drifting phase at re-key time. */
  phaseJump: number;
  ratioChanged: boolean;
}

export interface GripState {
  start: number;
  deadline: number;
  reason: 'neural' | 'rekey';
}

export interface IceLayerState {
  index: number;
  ratio: Ratio;
  phi: number;
  /** Breaker roll; observed phase is Phi + roll. */
  roll: number;
  meter: number;
  m: number;
  telegraph: RekeyTelegraph | null;
  nextRekeyAt: number | null;
}

export interface IceState {
  t: number;
  iceId: string;
  layer: number;
  status: IceStatus;
  frozen: boolean;
  trace: number;
  neural: number;
  grip: GripState | null;
  current: IceLayerState;
  /**
   * Multiplier on lock-meter drain only (1 = normal). Dixie auto-hold writes
   * 0.5 while simstim is flipped (`companion/Dixie.lockDecayScale`).
   */
  lockDecayScale: number;
}

/** M4.4 soft modifiers. Optional on `IceModel.step`; Wintermute freeze stays `setFrozen`. */
export interface IceSoftMods {
  /** CLAMP: hold phase drift without pausing the re-key clock. */
  freezeDrift?: boolean;
  /** DAMPER: multiply `feedbackDps` (0.3 = 70% cut). */
  feedbackMul?: number;
  /** DECOY: multiply engaged `traceRate` (0.5 = half gain). */
  traceMul?: number;
}

export interface IceStepInput extends IceSoftMods {
  /** Breaker ratio knob R. */
  R: number;
  /** Breaker phase knob (roll is added inside the model). */
  Phi: number;
}

export type IceSimEvent =
  | { type: 'iceEngaged'; iceId: string; layer: number }
  | { type: 'iceRekeyTelegraph'; iceId: string; inSeconds: number }
  | { type: 'iceRekey'; iceId: string }
  | { type: 'iceLayerCracked'; iceId: string; layer: number }
  | { type: 'gripStart'; iceId: string }
  | { type: 'gripEnd'; iceId: string };

export interface IceModel {
  readonly def: IceDef;
  readonly state: IceState;
  engage(layer?: number): void;
  disengage(): void;
  setFrozen(on: boolean): void;
  /** Lab / tests: start a telegraph immediately (even if the layer never re-keys). */
  forceTelegraph(): IceSimEvent[];
  /** Lab / tests: start grip if the current layer defines it. */
  forceGrip(reason?: GripState['reason']): IceSimEvent[];
  /** Crack the current layer now (lock meter → 1). */
  crack(): IceSimEvent[];
  /** CLAMP: push the next re-key (and live telegraph) later by `seconds`. */
  delayRekey(seconds: number): void;
  step(dt: number, input: IceStepInput): IceSimEvent[];
}

export interface CreateIceModelOptions {
  seed?: number;
  events?: EventBus;
  trace?: number;
  neural?: number;
}

function sameRatio(a: Ratio, b: Ratio): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pickRatio(rng: Pcg32, ratios: ReadonlyArray<Ratio>, avoid?: Ratio): Ratio {
  if (ratios.length === 0) return [1, 1];
  if (!avoid || ratios.length === 1) return ratios[rng.below(ratios.length)]!;
  const others = ratios.filter((r) => !sameRatio(r, avoid));
  if (others.length === 0) return avoid;
  return others[rng.below(others.length)]!;
}

/**
 * One ICE (possibly multi-layer): phase drift, telegraphed re-keys, lock meter,
 * local neural/trace for grip, grip state. Does not own engage-from-facet,
 * jack-out, Flatline, or deck Trace/NeuralLoad (M4.3).
 */
export function createIceModel(def: IceDef, opts: CreateIceModelOptions = {}): IceModel {
  if (def.layers.length === 0) throw new Error(`IceDef '${def.id}' has no layers`);
  const rng = new Pcg32(opts.seed ?? 1, 0x1ce);
  let driftDir = rng.next() < 0.5 ? -1 : 1;
  let nextDriftFlip = rng.float(2, 5);
  const events = opts.events;

  const layerState = (index: number, t: number): IceLayerState => {
    const layer = def.layers[index]!;
    return {
      index,
      ratio: pickRatio(rng, layer.ratios),
      phi: rng.float(0, TAU),
      roll: 0,
      meter: 0,
      m: 0,
      telegraph: null,
      nextRekeyAt: layer.rekeyEvery
        ? t + rng.float(layer.rekeyEvery[0], layer.rekeyEvery[1])
        : null,
    };
  };

  const state: IceState = {
    t: 0,
    iceId: def.id,
    layer: 0,
    status: 'idle',
    frozen: false,
    trace: opts.trace ?? 0,
    neural: opts.neural ?? 0,
    grip: null,
    current: layerState(0, 0),
    lockDecayScale: 1,
  };

  const emit = (list: IceSimEvent[], ev: IceSimEvent): void => {
    list.push(ev);
    events?.post(ev);
  };

  const layerDef = (): IceLayerDef => def.layers[state.current.index]!;

  const startGrip = (reason: GripState['reason'], list: IceSimEvent[]): void => {
    const g = layerDef().grip;
    if (!g || state.grip) return;
    state.grip = { start: state.t, deadline: state.t + g.seconds, reason };
    state.current.telegraph = null;
    state.current.nextRekeyAt = null;
    emit(list, { type: 'gripStart', iceId: def.id });
  };

  const endGrip = (list: IceSimEvent[]): void => {
    if (!state.grip) return;
    state.grip = null;
    emit(list, { type: 'gripEnd', iceId: def.id });
  };

  const planRekey = (at: number): RekeyTelegraph => {
    const layer = layerDef();
    const cur = state.current.ratio;
    const others = layer.ratios.filter((r) => !sameRatio(r, cur));
    const ratioChanged = others.length > 0 && rng.next() < REKEY_RATIO_CHANGE_P;
    const next = ratioChanged ? pickRatio(rng, others) : cur;
    const phaseJump = ratioChanged
      ? rng.float(0, TAU)
      : (rng.next() < 0.5 ? -1 : 1) * rng.float(Math.PI / 2, (3 * Math.PI) / 2);
    return {
      start: at - layer.telegraph,
      end: at,
      next,
      phaseJump,
      ratioChanged,
    };
  };

  const crackCurrent = (list: IceSimEvent[]): void => {
    const cracked = state.current.index;
    endGrip(list);
    emit(list, { type: 'iceLayerCracked', iceId: def.id, layer: cracked });
    const next = cracked + 1;
    if (next >= def.layers.length) {
      state.status = 'cracked';
      state.current.meter = 1;
      return;
    }
    state.layer = next;
    state.current = layerState(next, state.t);
    emit(list, { type: 'iceEngaged', iceId: def.id, layer: next });
  };

  const api: IceModel = {
    def,
    state,
    engage(layer = 0) {
      const idx = Math.min(def.layers.length - 1, Math.max(0, layer | 0));
      state.t = 0;
      state.layer = idx;
      state.status = 'engaged';
      state.frozen = false;
      state.grip = null;
      state.current = layerState(idx, 0);
      driftDir = rng.next() < 0.5 ? -1 : 1;
      nextDriftFlip = rng.float(2, 5);
      const list: IceSimEvent[] = [];
      emit(list, { type: 'iceEngaged', iceId: def.id, layer: idx });
    },
    disengage() {
      const list: IceSimEvent[] = [];
      endGrip(list);
      state.status = 'idle';
      state.current.telegraph = null;
    },
    setFrozen(on) {
      state.frozen = on;
    },
    forceTelegraph() {
      const list: IceSimEvent[] = [];
      if (state.status !== 'engaged' || state.frozen) return list;
      const layer = layerDef();
      const warn = Math.max(layer.telegraph, 0.35);
      const at = state.t + warn;
      state.current.nextRekeyAt = at;
      state.current.telegraph = planRekey(at);
      emit(list, { type: 'iceRekeyTelegraph', iceId: def.id, inSeconds: warn });
      return list;
    },
    forceGrip(reason = 'neural') {
      const list: IceSimEvent[] = [];
      if (state.status !== 'engaged') return list;
      startGrip(reason, list);
      return list;
    },
    crack() {
      const list: IceSimEvent[] = [];
      if (state.status !== 'engaged') return list;
      state.current.meter = 1;
      crackCurrent(list);
      return list;
    },
    delayRekey(seconds) {
      if (!(seconds > 0) || state.status !== 'engaged') return;
      const cur = state.current;
      if (cur.nextRekeyAt !== null) cur.nextRekeyAt += seconds;
      if (cur.telegraph) {
        cur.telegraph.start += seconds;
        cur.telegraph.end += seconds;
      }
    },
    step(dt, input) {
      const list: IceSimEvent[] = [];
      if (state.status !== 'engaged' || dt <= 0) return list;
      state.t += dt;
      const layer = layerDef();
      const cur = state.current;
      const freezeDrift = input.freezeDrift === true;
      const feedbackMul = input.feedbackMul ?? 1;
      const traceMul = input.traceMul ?? 1;

      if (!state.frozen) {
        if (!freezeDrift) {
          if (state.t >= nextDriftFlip) {
            driftDir = -driftDir;
            nextDriftFlip = state.t + rng.float(2, 5);
          }
          cur.phi = wrapPositive(cur.phi + driftDir * layer.phaseDrift * dt);
        }

        if (cur.nextRekeyAt !== null && !cur.telegraph && !state.grip) {
          const warnAt = cur.nextRekeyAt - layer.telegraph;
          if (state.t >= warnAt) {
            cur.telegraph = planRekey(cur.nextRekeyAt);
            emit(list, {
              type: 'iceRekeyTelegraph',
              iceId: def.id,
              inSeconds: Math.max(0, cur.telegraph.end - state.t),
            });
          }
        }

        if (cur.telegraph && state.t >= cur.telegraph.end) {
          const tg = cur.telegraph;
          const before = cur.meter;
          cur.ratio = tg.next;
          cur.phi = wrapPositive(cur.phi + tg.phaseJump);
          cur.meter = rekeyMeterReset(before);
          cur.telegraph = null;
          cur.nextRekeyAt = layer.rekeyEvery
            ? state.t + rng.float(layer.rekeyEvery[0], layer.rekeyEvery[1])
            : null;
          emit(list, { type: 'iceRekey', iceId: def.id });
          if (layer.grip && !state.grip && before < 0.3) startGrip('rekey', list);
        }
      }

      const [a, b] = cur.ratio;
      cur.roll = stepRoll(cur.roll, input.R, a, b, dt);
      cur.m = matchMetric(input.R, input.Phi + cur.roll, a, b, cur.phi, layer.tolRatio);
      cur.meter = stepLockMeter(cur.meter, cur.m, dt, layer.lockTime, state.lockDecayScale);

      if (cur.meter >= 1) {
        crackCurrent(list);
        return list;
      }

      state.trace = Math.min(100, state.trace + layer.traceRate * traceMul * dt);
      if (cur.m < DISSONANCE_THRESHOLD) {
        state.neural = Math.min(100, state.neural + layer.feedbackDps * feedbackMul * dt);
      }
      if (layer.grip && !state.grip && state.neural > layer.grip.neuralThreshold) {
        startGrip('neural', list);
      }
      return list;
    },
  };
  return api;
}
