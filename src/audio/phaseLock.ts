/**
 * Phase Lock audio coupling (plan §3.5 / §7 / §9.7 `audio.phaseLock`).
 *
 * Stereo bed matches the 2D lab (`prototypes/phase-lock/src/lab/audio.ts`):
 *   ICE x → left  `a·f0` sine; ICE y → right `b·f0` sine
 *   Breaker x → left `a·f0` triangle; breaker y → right `R·a·f0` triangle
 * A ratio mismatch beats on the right at `|R·a − b|·f0` Hz. A match is a
 * just interval (3:2 a fifth, 4:3 a fourth). Phase alignment is heard as
 * constructive interference on the left.
 *
 * Pure helpers live here so the engine and breach controller can share them
 * without importing `breach/PhaseLock.ts` (that module stays lazy).
 */

import type { AudioEngine, MusicMode } from './AudioEngine';
import { quantizeHz } from './music/Harmony';

/** Default f0: A2, the mission-key root (plan §3.5, 110–220 Hz). */
export const PHASE_LOCK_F0 = 110;
/** Re-key slide time-constant when `setTarget` jumps a:b in one call. */
export const PHASE_LOCK_SLIDE_TAU = 0.18;
/** Tight tracking while the controller interpolates telegraph partials. */
export const PHASE_LOCK_TRACK_TAU = 0.02;

export interface PhaseLockBed {
  /** Quantized mission-key f0. */
  f0: number;
  iceL: number;
  iceR: number;
  brkL: number;
  brkR: number;
  /** `|brkR − iceR|` — audible beat frequency on the right. */
  beatingHz: number;
  /** Phase consonance 0..1, `(0.5 + 0.5·cos(Φ − φ))⁴`. */
  cons: number;
  /** Ratio match 0..1 (gaussian in log units, default tol 0.06). */
  mR: number;
  /** `mR * cons`. */
  m: number;
}

export interface PhaseLockTelegraph {
  nextA: number;
  nextB: number;
  /** 0 at telegraph start, 1 at re-key. */
  k: number;
}

export interface PhaseLockDriveInput {
  engaged: boolean;
  a: number;
  b: number;
  phi: number;
  R: number;
  Phi: number;
  telegraph: PhaseLockTelegraph | null;
  grip: boolean;
  meter: number;
}

export interface PhaseLockSession {
  started: boolean;
  music: 'breach' | 'grip' | null;
}

export interface PhaseLockVoice {
  start(a: number, b: number, f0: number): void;
  setTarget(a: number, b: number, phi: number): void;
  setPlayer(R: number, Phi: number): void;
  stop(): void;
  setGrip(on: boolean): void;
  setAudible(on: boolean): void;
  tick(dt: number): void;
  snapshot(): PhaseLockBed;
  running(): boolean;
  gripping(): boolean;
  dispose(): void;
}

export function telegraphBlend(
  a: number,
  b: number,
  tel: PhaseLockTelegraph | null,
): { a: number; b: number } {
  if (!tel) return { a, b };
  const k = tel.k < 0 ? 0 : tel.k > 1 ? 1 : tel.k;
  return { a: a + (tel.nextA - a) * k, b: b + (tel.nextB - b) * k };
}

export function telegraphProgress(t: number, start: number, end: number): number {
  const dur = end - start;
  if (!(dur > 1e-6)) return 1;
  const k = (t - start) / dur;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

/** Phase consonance, 0..1. Independent of the twin-phase visual metric. */
export function phaseConsonance(Phi: number, phi: number): number {
  const c = 0.5 + 0.5 * Math.cos(Phi - phi);
  const c2 = c * c;
  return c2 * c2;
}

/** Gaussian ratio match in log units (plan §3.5 `mR`, default tol 0.06). */
export function ratioConsonance(R: number, a: number, b: number, tol = 0.06): number {
  const safeR = R > 1e-6 ? R : 1e-6;
  const safeA = a > 1e-6 ? a : 1e-6;
  const e = Math.abs(Math.log(safeR) - Math.log(b / safeA)) / (tol > 1e-6 ? tol : 0.06);
  return Math.exp(-e * e);
}

export function beatingHz(a: number, b: number, R: number, f0: number): number {
  return Math.abs(R * a - b) * f0;
}

/**
 * Just-intonation bed on a mission-key f0. ICE partials stay `a·f0` / `b·f0`
 * so a 3:2 is a fifth; the breaker right channel is continuous in R so a
 * mismatch beats instead of snapping to 12-TET.
 */
export function phaseLockBed(
  a: number,
  b: number,
  f0: number,
  root: number,
  mode: MusicMode,
  R: number,
  Phi: number,
  phi: number,
): PhaseLockBed {
  const f0InKey = quantizeHz(Math.max(1, f0), root, mode);
  const ia = Math.max(1e-6, a);
  const ib = Math.max(1e-6, b);
  const iceL = ia * f0InKey;
  const iceR = ib * f0InKey;
  const brkL = iceL;
  const brkR = Math.min(4000, Math.max(1e-6, R) * iceL);
  const cons = phaseConsonance(Phi, phi);
  const mR = ratioConsonance(R, ia, ib);
  return {
    f0: f0InKey,
    iceL,
    iceR,
    brkL,
    brkR,
    beatingHz: Math.abs(brkR - iceR),
    cons,
    mR,
    m: mR * cons,
  };
}

/**
 * Drive §9.7 `phaseLock` + music state from a breach snapshot. Safe on the
 * no-op engine. Does not allocate on the stop path besides the four API calls.
 */
export function syncPhaseLockEngine(
  audio: Pick<AudioEngine, 'phaseLock' | 'music'>,
  session: PhaseLockSession,
  input: PhaseLockDriveInput | null,
  f0: number,
): void {
  if (!input || !input.engaged) {
    if (session.started) {
      audio.phaseLock.stop();
      session.started = false;
    }
    session.music = null;
    return;
  }
  const blended = telegraphBlend(input.a, input.b, input.telegraph);
  if (!session.started) {
    audio.phaseLock.start(input.a, input.b, f0);
    session.started = true;
  }
  audio.phaseLock.setTarget(blended.a, blended.b, input.phi);
  audio.phaseLock.setPlayer(input.R, input.Phi);
  const want: 'breach' | 'grip' = input.grip ? 'grip' : 'breach';
  if (session.music !== want) {
    audio.music.setState(want);
    session.music = want;
  }
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/**
 * Live stereo bed + grip ring-mod growl / heartbeat. Nodes are created once
 * at unlock; start/stop only automate gains.
 */
export function createPhaseLockVoice(ctx: AudioContext, dest: AudioNode): PhaseLockVoice {
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bed.connect(dest);

  const merger = ctx.createChannelMerger(2);
  merger.connect(bed);

  const mk = (
    type: OscillatorType,
    ch: 0 | 1,
    level: number,
  ): { osc: OscillatorNode; gain: GainNode } => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = PHASE_LOCK_F0;
    const gain = ctx.createGain();
    gain.gain.value = level;
    osc.connect(gain).connect(merger, 0, ch);
    osc.start();
    return { osc, gain };
  };

  const iceL = mk('sine', 0, 0.12);
  const iceR = mk('sine', 1, 0.12);
  const brkL = mk('triangle', 0, 0.09);
  const brkR = mk('triangle', 1, 0.09);

  const growlOsc = ctx.createOscillator();
  growlOsc.type = 'sawtooth';
  growlOsc.frequency.value = 41;
  const growlMod = ctx.createOscillator();
  growlMod.frequency.value = 29;
  const growlRing = ctx.createGain();
  growlRing.gain.value = 0;
  growlMod.connect(growlRing.gain);
  const growlLp = ctx.createBiquadFilter();
  growlLp.type = 'lowpass';
  growlLp.frequency.value = 220;
  const growlGain = ctx.createGain();
  growlGain.gain.value = 0;
  growlOsc.connect(growlRing).connect(growlLp).connect(growlGain).connect(dest);
  growlOsc.start();
  growlMod.start();

  let a = 2;
  let b = 3;
  let f0 = PHASE_LOCK_F0;
  let phi = 0;
  let R = 1;
  let Phi = 0;
  let running = false;
  let gripping = false;
  let audible = true;
  let heartTimer = 0;
  let lastA = 2;
  let lastB = 3;

  const snapshotBed = (): PhaseLockBed => {
    const f = Math.max(1, f0);
    const iceLhz = Math.max(1e-6, a) * f;
    const iceRhz = Math.max(1e-6, b) * f;
    const brkRhz = Math.min(4000, Math.max(1e-6, R) * iceLhz);
    const cons = phaseConsonance(Phi, phi);
    const mR = ratioConsonance(R, a, b);
    return {
      f0: f,
      iceL: iceLhz,
      iceR: iceRhz,
      brkL: iceLhz,
      brkR: brkRhz,
      beatingHz: Math.abs(brkRhz - iceRhz),
      cons,
      mR,
      m: mR * cons,
    };
  };

  const apply = (slide: boolean): void => {
    const t = ctx.currentTime;
    const snap = snapshotBed();
    const tau = slide ? PHASE_LOCK_SLIDE_TAU : PHASE_LOCK_TRACK_TAU;
    iceL.osc.frequency.setTargetAtTime(Math.max(20, snap.iceL), t, tau);
    iceR.osc.frequency.setTargetAtTime(Math.max(20, snap.iceR), t, tau);
    brkL.osc.frequency.setTargetAtTime(Math.max(20, snap.brkL), t, PHASE_LOCK_TRACK_TAU);
    brkR.osc.frequency.setTargetAtTime(Math.max(20, snap.brkR), t, 0.01);
    iceL.gain.gain.setTargetAtTime(0.06 + 0.08 * snap.cons, t, 0.03);
    iceR.gain.gain.setTargetAtTime(slide ? 0.09 : 0.12, t, 0.03);
    brkL.gain.gain.setTargetAtTime(0.04 + 0.07 * snap.cons, t, 0.03);
    brkR.gain.gain.setTargetAtTime(0.07 + 0.04 * snap.m, t, 0.03);
    const bedLevel = !running || !audible ? 0 : gripping ? 0.45 : 1;
    bed.gain.setTargetAtTime(bedLevel, t, 0.08);
    growlGain.gain.setTargetAtTime(running && audible && gripping ? 0.35 : 0, t, 0.08);
  };

  const thump = (when: number, level: number): void => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, when);
    o.frequency.exponentialRampToValueAtTime(38, when + 0.15);
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    env(g, when, audible ? level : 0.0001, 0.004, 0.18);
    o.start(when);
    o.stop(when + 0.25);
  };

  const api: PhaseLockVoice = {
    start(nextA, nextB, nextF0) {
      a = nextA;
      b = nextB;
      f0 = nextF0;
      lastA = nextA;
      lastB = nextB;
      running = true;
      apply(false);
    },
    setTarget(nextA, nextB, nextPhi) {
      const jump = Math.abs(nextA - lastA) + Math.abs(nextB - lastB) > 0.08;
      a = nextA;
      b = nextB;
      phi = nextPhi;
      lastA = nextA;
      lastB = nextB;
      if (running) apply(jump);
    },
    setPlayer(nextR, nextPhi) {
      R = nextR;
      Phi = nextPhi;
      if (running) apply(false);
    },
    stop() {
      running = false;
      gripping = false;
      heartTimer = 0;
      apply(false);
    },
    setGrip(on) {
      if (gripping === on) return;
      gripping = on;
      heartTimer = 0;
      if (running) apply(false);
    },
    setAudible(on) {
      if (audible === on) return;
      audible = on;
      apply(false);
    },
    tick(dt) {
      if (!running || !gripping || !audible) return;
      heartTimer -= dt;
      if (heartTimer > 0) return;
      heartTimer = 0.62;
      const t = ctx.currentTime;
      thump(t, 0.5);
      thump(t + 0.18, 0.35);
    },
    snapshot() {
      return snapshotBed();
    },
    running: () => running,
    gripping: () => gripping,
    dispose() {
      running = false;
      const t = ctx.currentTime;
      try {
        iceL.osc.stop(t + 0.05);
        iceR.osc.stop(t + 0.05);
        brkL.osc.stop(t + 0.05);
        brkR.osc.stop(t + 0.05);
        growlOsc.stop(t + 0.05);
        growlMod.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      bed.disconnect();
      growlGain.disconnect();
    },
  };
  return api;
}
