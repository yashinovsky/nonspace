/** Shared noise generator (white / pink). Used by the worklet and by buffer fallbacks. */
export interface NoiseState {
  seed: number;
  /** 0 = white, 1 = pink (Paul Kellet). */
  mode: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  b6: number;
}

export interface NoiseWorkletMessage {
  type: 'mode';
  mode: number;
}

export function noiseWorkletKernel() {
  function createNoiseState(seed = 0x9e3779b9, mode = 0): NoiseState {
    return { seed: seed >>> 0, mode, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
  }

  function tickNoise(state: NoiseState): number {
    state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
    const white = (state.seed / 4294967295) * 2 - 1;
    if (state.mode === 0) return white;
    state.b0 = 0.99886 * state.b0 + white * 0.0555179;
    state.b1 = 0.99332 * state.b1 + white * 0.0750759;
    state.b2 = 0.969 * state.b2 + white * 0.153852;
    state.b3 = 0.8665 * state.b3 + white * 0.3104856;
    state.b4 = 0.55 * state.b4 + white * 0.5329522;
    state.b5 = -0.7616 * state.b5 - white * 0.016898;
    const pink =
      state.b0 + state.b1 + state.b2 + state.b3 + state.b4 + state.b5 + state.b6 + white * 0.5362;
    state.b6 = white * 0.115926;
    return pink * 0.11;
  }

  function mixNoise(state: NoiseState, left: Float32Array, right: Float32Array): void {
    const n = left.length;
    for (let i = 0; i < n; i++) {
      const s = tickNoise(state);
      left[i] = s;
      right[i] = s;
    }
  }

  function applyNoiseMessage(state: NoiseState, msg: NoiseWorkletMessage): void {
    if (msg.type === 'mode') state.mode = msg.mode ? 1 : 0;
  }

  return { createNoiseState, tickNoise, mixNoise, applyNoiseMessage };
}

const kernel = noiseWorkletKernel();
export const createNoiseState = kernel.createNoiseState;
export const tickNoise = kernel.tickNoise;
export const mixNoise = kernel.mixNoise;
export const applyNoiseMessage = kernel.applyNoiseMessage;

/** Pitch envelope: exponential start→end over `dur` seconds. */
export function expSweep(start: number, end: number, t: number, dur: number): number {
  if (t <= 0) return start;
  if (t >= dur) return end;
  if (start <= 0 || end <= 0) return end;
  return start * Math.pow(end / start, t / dur);
}
