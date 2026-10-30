export const FM_VOICE_COUNT = 16;

/** ADSR stage: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release. */
export interface AdsState {
  stage: number;
  env: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface FmVoiceState extends AdsState {
  active: number;
  amp: number;
  pan: number;
  carPhase: number;
  modPhase: number;
  carFreq: number;
  modRatio: number;
  index: number;
}

export interface FmWorkletMessage {
  type: 'on' | 'off' | 'allOff';
  i?: number;
  freq?: number;
  amp?: number;
  ratio?: number;
  index?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  pan?: number;
}

/**
 * All worklet DSP lives inside this one function so production minify keeps
 * inner calls consistent when the body is copied via toString() into a
 * classic AudioWorklet script.
 */
export function fmWorkletKernel() {
  function tickAdsr(v: AdsState, sampleRate: number): number {
    const sr = sampleRate;
    if (v.stage === 1) {
      const step = v.attack > 0 ? 1 / (v.attack * sr) : 1;
      v.env += step;
      if (v.env >= 1) {
        v.env = 1;
        v.stage = 2;
      }
    } else if (v.stage === 2) {
      const drop = 1 - v.sustain;
      const step = v.decay > 0 ? drop / (v.decay * sr) : drop;
      v.env -= step;
      if (v.env <= v.sustain) {
        v.env = v.sustain;
        v.stage = 3;
      }
    } else if (v.stage === 3) {
      v.env = v.sustain;
    } else if (v.stage === 4) {
      const step = v.release > 0 ? v.env / (v.release * sr) : v.env;
      v.env -= step;
      if (v.env <= 0.0001) {
        v.env = 0;
        v.stage = 0;
      }
    } else {
      v.env = 0;
    }
    return v.env;
  }

  function createFmVoiceState(): FmVoiceState {
    return {
      active: 0,
      stage: 0,
      env: 0,
      amp: 0,
      pan: 0,
      carPhase: 0,
      modPhase: 0,
      carFreq: 440,
      modRatio: 2,
      index: 1.5,
      attack: 0.005,
      decay: 0.08,
      sustain: 0.6,
      release: 0.12,
    };
  }

  function applyFmMessage(voices: FmVoiceState[], msg: FmWorkletMessage): void {
    if (msg.type === 'allOff') {
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (v && v.stage !== 0) v.stage = 4;
      }
      return;
    }
    const idx = msg.i;
    if (idx === undefined) return;
    const v = voices[idx];
    if (!v) return;
    if (msg.type === 'off') {
      if (v.stage !== 0) v.stage = 4;
      return;
    }
    v.active = 1;
    v.stage = 1;
    v.env = 0;
    v.carPhase = 0;
    v.modPhase = 0;
    if (msg.freq !== undefined) v.carFreq = msg.freq;
    if (msg.amp !== undefined) v.amp = msg.amp;
    if (msg.ratio !== undefined) v.modRatio = msg.ratio;
    if (msg.index !== undefined) v.index = msg.index;
    if (msg.attack !== undefined) v.attack = msg.attack;
    if (msg.decay !== undefined) v.decay = msg.decay;
    if (msg.sustain !== undefined) v.sustain = msg.sustain;
    if (msg.release !== undefined) v.release = msg.release;
    if (msg.pan !== undefined) v.pan = msg.pan;
  }

  function tickFmVoice(v: FmVoiceState, sampleRate: number): number {
    if (v.stage === 0) {
      v.active = 0;
      return 0;
    }
    tickAdsr(v, sampleRate);
    if (v.env <= 0) return 0;
    const twoPi = 6.283185307179586;
    const srInv = 1 / sampleRate;
    v.modPhase += twoPi * v.carFreq * v.modRatio * srInv;
    if (v.modPhase > twoPi) v.modPhase -= twoPi * Math.floor(v.modPhase / twoPi);
    const mod = Math.sin(v.modPhase) * v.index;
    v.carPhase += twoPi * v.carFreq * srInv;
    if (v.carPhase > twoPi) v.carPhase -= twoPi * Math.floor(v.carPhase / twoPi);
    return v.env * v.amp * Math.sin(v.carPhase + mod);
  }

  function mixFmVoices(
    voices: FmVoiceState[],
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
  ): void {
    const n = left.length;
    for (let i = 0; i < n; i++) {
      let l = 0;
      let r = 0;
      for (let vi = 0; vi < voices.length; vi++) {
        const voice = voices[vi];
        if (!voice) continue;
        const s = tickFmVoice(voice, sampleRate);
        if (s === 0) continue;
        const x = (voice.pan + 1) * 0.7853981633974483;
        l += s * Math.cos(x);
        r += s * Math.sin(x);
      }
      left[i] = l;
      right[i] = r;
    }
  }

  return { tickAdsr, tickFmVoice, mixFmVoices, createFmVoiceState, applyFmMessage };
}

const kernel = fmWorkletKernel();
export const tickAdsr = kernel.tickAdsr;
export const tickFmVoice = kernel.tickFmVoice;
export const mixFmVoices = kernel.mixFmVoices;
export const createFmVoiceState = kernel.createFmVoiceState;
export const applyFmMessage = kernel.applyFmMessage;
