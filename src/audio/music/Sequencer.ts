import type { MusicMode, MusicState } from '../AudioEngine';
import { DEFAULT_MODE, DEFAULT_ROOT_MIDI, degreeToHz } from './Harmony';
import {
  LAYER_IDS,
  lerpGains,
  mixPatternGains,
  OPEN_FILTER_HZ,
  PATTERNS,
  zeroGains,
  type LayerGains,
  type LayerId,
  type MusicPattern,
} from './patterns';

export const DEFAULT_BPM = 96;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

export interface TempoClock {
  bpm: number;
  /** Audio (or test) time of beat 0 / step 0. */
  origin: number;
  beatsPerBar: number;
  stepsPerBar: number;
}

export function createTempoClock(bpm = DEFAULT_BPM, origin = 0): TempoClock {
  return { bpm, origin, beatsPerBar: BEATS_PER_BAR, stepsPerBar: STEPS_PER_BAR };
}

export function beatDuration(bpm: number): number {
  return 60 / Math.max(1, bpm);
}

export function barDuration(bpm: number): number {
  return beatDuration(bpm) * BEATS_PER_BAR;
}

export function stepDuration(bpm: number): number {
  return beatDuration(bpm) / STEPS_PER_BEAT;
}

export function beatsAt(t: number, clock: TempoClock): number {
  return (t - clock.origin) * (clock.bpm / 60);
}

export function stepsAt(t: number, clock: TempoClock): number {
  return beatsAt(t, clock) * STEPS_PER_BEAT;
}

export function nearestBeatTime(t: number, clock: TempoClock): number {
  const beat = beatDuration(clock.bpm);
  const n = Math.round((t - clock.origin) / beat);
  return clock.origin + n * beat;
}

export function nextBarTime(t: number, clock: TempoClock): number {
  const bar = barDuration(clock.bpm);
  const elapsed = t - clock.origin;
  const n = Math.floor(elapsed / bar + 1e-12) + 1;
  return clock.origin + n * bar;
}

/**
 * Construct pulse envelope in [0, 1]. Peaks at 1 on each quarter-note beat of
 * the tempo grid (phase-locked to `clock.origin`) so the renderer can drive
 * intensity in sync with the sequencer (±10 ms AC).
 *
 * `pulse(t)` uses 96 BPM / origin 0. Pass a BPM number or a live `TempoClock`.
 */
export function pulse(t: number, bpmOrClock: number | TempoClock = DEFAULT_BPM): number {
  const clock = typeof bpmOrClock === 'number' ? createTempoClock(bpmOrClock, 0) : bpmOrClock;
  const beats = beatsAt(t, clock);
  const phase = beats - Math.floor(beats);
  return 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
}

export type MusicEventKind = 'arp' | 'bass' | 'hat' | 'kick' | 'snare' | 'heartbeat' | 'dubBass';

export interface MusicEvent {
  kind: MusicEventKind;
  time: number;
  freq: number;
  amp: number;
  step: number;
  layer: LayerId;
  open?: boolean;
}

export interface SequencerStep {
  index: number;
  bar: number;
  time: number;
}

export interface SequencerTick {
  events: MusicEvent[];
  steps: SequencerStep[];
}

export interface CrossfadeState {
  fromState: MusicState;
  toState: MusicState;
  start: number;
  duration: number;
  progress: number;
}

interface InternalCrossfade {
  fromState: MusicState;
  fromGains: LayerGains;
  fromFilter: number;
  toState: MusicState;
  start: number;
  duration: number;
}

const KIND_OF: Partial<Record<LayerId, MusicEventKind>> = {
  arp: 'arp',
  bass: 'bass',
  hats: 'hat',
  kick: 'kick',
  snare: 'snare',
  heartbeat: 'heartbeat',
  dubBass: 'dubBass',
};

export interface SequencerOptions {
  now?: () => number;
  bpm?: number;
  root?: number;
  mode?: MusicMode;
  rng?: () => number;
  origin?: number;
}

export interface Sequencer {
  readonly clock: TempoClock;
  state: MusicState;
  root: number;
  mode: MusicMode;
  /** 0..1 lock meter; scales breach percussion (M5.4 will drive this). */
  lockMeter: number;
  now(): number;
  setState(state: MusicState, when?: number): void;
  setTempo(bpm: number, when?: number): void;
  setKey(root: number, mode: MusicMode): void;
  align(origin: number): void;
  gainsAt(t: number): LayerGains;
  filterHzAt(t: number): number;
  duckDb(): number | undefined;
  crossfadeAt(t: number): CrossfadeState | null;
  pattern(state?: MusicState): MusicPattern;
  tick(now: number, lookahead?: number): SequencerTick;
}

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function patternFilter(p: MusicPattern): number {
  return p.filterHz ?? OPEN_FILTER_HZ;
}

export function createSequencer(opts: SequencerOptions = {}): Sequencer {
  const nowFn = opts.now ?? (() => 0);
  let clock = createTempoClock(opts.bpm ?? DEFAULT_BPM, opts.origin ?? 0);
  let state: MusicState = 'silent';
  let root = opts.root ?? DEFAULT_ROOT_MIDI;
  let mode: MusicMode = opts.mode ?? DEFAULT_MODE;
  let lockMeter = 0;
  const rng = opts.rng ?? Math.random;
  let fade: InternalCrossfade | null = null;
  let nextStepTime = clock.origin;
  let nextStepIndex = 0;
  let stateEntered = clock.origin;
  let tempoLocked = false;

  const api: Sequencer = {
    get clock() {
      return clock;
    },
    get state() {
      return state;
    },
    set state(s) {
      api.setState(s);
    },
    get root() {
      return root;
    },
    set root(v) {
      root = v;
    },
    get mode() {
      return mode;
    },
    set mode(v) {
      mode = v;
    },
    get lockMeter() {
      return lockMeter;
    },
    set lockMeter(v) {
      lockMeter = clamp01(v);
    },
    now: () => nowFn(),
    setState(next, when) {
      const t = when ?? nowFn();
      if (next === state && !fade) return;
      const duration = barDuration(clock.bpm);
      fade = {
        fromState: state,
        fromGains: api.gainsAt(t),
        fromFilter: api.filterHzAt(t),
        toState: next,
        start: t,
        duration,
      };
      state = next;
      stateEntered = t;
      if (!tempoLocked) applyTempo(PATTERNS[next].bpm ?? DEFAULT_BPM, t, false);
    },
    setTempo(bpm, when) {
      applyTempo(bpm, when ?? nowFn(), true);
    },
    setKey(nextRoot, nextMode) {
      root = nextRoot;
      mode = nextMode;
    },
    align(origin) {
      clock = createTempoClock(clock.bpm, origin);
      nextStepTime = origin;
      nextStepIndex = 0;
    },
    gainsAt(t) {
      const to = mixPatternGains(PATTERNS[state]);
      if (!fade) return to;
      const x = clamp01((t - fade.start) / fade.duration);
      if (x >= 1) {
        fade = null;
        return to;
      }
      return lerpGains(fade.fromGains, to, x);
    },
    filterHzAt(t) {
      const to = patternFilter(PATTERNS[state]);
      if (!fade) return to;
      const x = clamp01((t - fade.start) / fade.duration);
      if (x >= 1) return to;
      return fade.fromFilter * (1 - x) + to * x;
    },
    duckDb() {
      return PATTERNS[state].duckDb;
    },
    crossfadeAt(t) {
      if (!fade) return null;
      const progress = clamp01((t - fade.start) / fade.duration);
      if (progress >= 1) {
        fade = null;
        return null;
      }
      return {
        fromState: fade.fromState,
        toState: fade.toState,
        start: fade.start,
        duration: fade.duration,
        progress,
      };
    },
    pattern(s) {
      return PATTERNS[s ?? state];
    },
    tick(now, lookahead = 0.1) {
      const events: MusicEvent[] = [];
      const steps: SequencerStep[] = [];
      const horizon = now + lookahead;
      const stepDur = stepDuration(clock.bpm);
      // Safety: never schedule more than a few bars per tick (paused tab, etc.).
      const maxSteps = STEPS_PER_BAR * 4;
      let n = 0;
      while (nextStepTime < horizon && n++ < maxSteps) {
        const index = ((nextStepIndex % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
        const bar = Math.floor(nextStepIndex / STEPS_PER_BAR);
        const time = nextStepTime;
        steps.push({ index, bar, time });
        const mixTo = fade ? clamp01((time - fade.start) / fade.duration) : 1;
        emitPattern(state, index, time, mixTo, events);
        if (fade && mixTo < 1) {
          emitPattern(fade.fromState, index, time, 1 - mixTo, events);
        }
        nextStepIndex++;
        nextStepTime += stepDur;
      }
      return { events, steps };
    },
  };

  function applyTempo(bpm: number, t: number, lock: boolean): void {
    const safe = Math.max(1, bpm);
    const beats = beatsAt(t, clock);
    clock = createTempoClock(safe, t - beats * (60 / safe));
    if (lock) tempoLocked = true;
    const stepDur = stepDuration(clock.bpm);
    const stepExact = stepsAt(t, clock);
    nextStepIndex = Math.ceil(stepExact - 1e-9);
    nextStepTime = clock.origin + nextStepIndex * stepDur;
  }

  function rising(): number {
    if (state !== 'kuangDive') return 1;
    const elapsed = Math.max(0, nowFn() - stateEntered);
    return 0.55 + 0.45 * clamp01(elapsed / 24);
  }

  function emitPattern(
    which: MusicState,
    step: number,
    time: number,
    mix: number,
    out: MusicEvent[],
  ): void {
    if (mix <= 0.001) return;
    const pattern = PATTERNS[which];
    const lockScale = which === 'breach' ? 0.15 + 0.85 * lockMeter : 1;
    const rise = which === 'kuangDive' ? rising() : 1;
    for (let i = 0; i < pattern.layers.length; i++) {
      const layer = pattern.layers[i]!;
      const kind = KIND_OF[layer.id];
      if (!kind) continue;
      const g = layer.gain * mix * lockScale * rise;
      if (g < 0.001) continue;
      for (let s = 0; s < layer.steps.length; s++) {
        const st = layer.steps[s]!;
        if (st.step !== step) continue;
        if (rng() > st.probability) continue;
        out.push({
          kind,
          time,
          freq: degreeToHz(st.degree ?? 0, root, mode, st.octave ?? 0),
          amp: g * st.vel,
          step,
          layer: layer.id,
          open: st.open,
        });
      }
    }
  }

  return api;
}

export { LAYER_IDS, PATTERNS, zeroGains, type LayerGains, type LayerId, type MusicPattern };
