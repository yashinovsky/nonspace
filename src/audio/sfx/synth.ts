import type { FmVoicePool } from '../voices/FmVoice';
import type { AudioBusGraph } from '../buses';
import type { MusicMode, SfxOptions } from '../AudioEngine';
import { createHrtfPanner } from '../spatial';

/** Shared graph handed to every recipe. Owned by the catalog / engine. */
export interface SfxWorld {
  ctx: AudioContext;
  graph: AudioBusGraph;
  fm: FmVoicePool;
  noise: AudioNode;
  duck: (bus: 'all' | 'music', db: number, seconds: number) => void;
  key: () => { root: number; mode: MusicMode };
}

export function sfxDest(
  world: SfxWorld,
  bus: 'sfx' | 'ui' | 'voice' | 'ambience' = 'sfx',
): AudioNode {
  return world.graph.input(bus);
}

export function pitchOf(opts?: SfxOptions): number {
  return opts?.pitch && opts.pitch > 0 ? opts.pitch : 1;
}

export function gainOf(opts?: SfxOptions, fallback = 1): number {
  return opts?.gain !== undefined ? Math.max(0, opts.gain) : fallback;
}

/** Per-event output: optional HRTF panner, then the sfx bus. */
export function route(
  world: SfxWorld,
  opts?: SfxOptions,
  bus: 'sfx' | 'ui' | 'voice' | 'ambience' = 'sfx',
): AudioNode {
  const dest = sfxDest(world, bus);
  if (!opts?.pos) return dest;
  const panner = createHrtfPanner(world.ctx, opts.pos);
  panner.connect(dest);
  return panner;
}

export function fireEnv(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  const p = Math.max(0.0001, peak);
  const a = Math.max(0.001, attack);
  const d = Math.max(0.01, decay);
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + a + d);
}

export interface OscHit {
  type?: OscillatorType;
  freq: number;
  amp: number;
  attack?: number;
  decay?: number;
  when?: number;
  dest?: AudioNode;
  slideTo?: number;
}

/** One-shot oscillator. Nodes disconnect after stop. */
export function playOsc(world: SfxWorld, hit: OscHit): OscillatorNode {
  const ctx = world.ctx;
  const t = hit.when ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = hit.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, hit.freq), t);
  if (hit.slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, hit.slideTo), t + (hit.decay ?? 0.2));
  }
  g.gain.value = 0;
  osc.connect(g).connect(hit.dest ?? sfxDest(world));
  fireEnv(g.gain, t, hit.amp, hit.attack ?? 0.004, hit.decay ?? 0.12);
  const stopAt = t + (hit.attack ?? 0.004) + (hit.decay ?? 0.12) + 0.05;
  osc.start(t);
  osc.stop(stopAt);
  osc.addEventListener('ended', () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {
      /* already gone */
    }
  });
  return osc;
}

export interface FmHit {
  freq: number;
  amp: number;
  ratio?: number;
  index?: number;
  attack?: number;
  decay?: number;
  when?: number;
  dest?: AudioNode;
  pan?: number;
}

/** Scheduled 2-op FM (own nodes, so it can start in the future). */
export function playFm(world: SfxWorld, hit: FmHit): void {
  const ctx = world.ctx;
  const t = hit.when ?? ctx.currentTime;
  const freq = Math.max(20, hit.freq);
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const amp = ctx.createGain();
  const pan = ctx.createStereoPanner();
  car.type = 'sine';
  mod.type = 'sine';
  car.frequency.setValueAtTime(freq, t);
  mod.frequency.setValueAtTime(freq * (hit.ratio ?? 2), t);
  modGain.gain.setValueAtTime(freq * (hit.index ?? 1.8), t);
  pan.pan.setValueAtTime(Math.max(-1, Math.min(1, hit.pan ?? 0)), t);
  amp.gain.value = 0;
  mod.connect(modGain).connect(car.frequency);
  car
    .connect(amp)
    .connect(pan)
    .connect(hit.dest ?? sfxDest(world));
  fireEnv(amp.gain, t, hit.amp, hit.attack ?? 0.004, hit.decay ?? 0.14);
  const stopAt = t + (hit.attack ?? 0.004) + (hit.decay ?? 0.14) + 0.08;
  car.start(t);
  mod.start(t);
  car.stop(stopAt);
  mod.stop(stopAt);
  car.addEventListener('ended', () => {
    try {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      amp.disconnect();
      pan.disconnect();
    } catch {
      /* already gone */
    }
  });
}

export interface NoiseHit {
  type?: BiquadFilterType;
  freq: number;
  q?: number;
  amp: number;
  attack?: number;
  decay?: number;
  when?: number;
  dest?: AudioNode;
  slideTo?: number;
}

/** Burst of the shared noise source through a filter + envelope. */
export function playNoise(world: SfxWorld, hit: NoiseHit): BiquadFilterNode {
  const ctx = world.ctx;
  const t = hit.when ?? ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  filter.type = hit.type ?? 'bandpass';
  filter.frequency.setValueAtTime(Math.max(40, hit.freq), t);
  if (hit.slideTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, hit.slideTo),
      t + (hit.attack ?? 0.01) + (hit.decay ?? 0.2),
    );
  }
  filter.Q.value = hit.q ?? 1.2;
  g.gain.value = 0;
  world.noise.connect(filter);
  filter.connect(g).connect(hit.dest ?? sfxDest(world));
  fireEnv(g.gain, t, hit.amp, hit.attack ?? 0.008, hit.decay ?? 0.18);
  const stopAt = t + (hit.attack ?? 0.008) + (hit.decay ?? 0.18) + 0.05;
  window.setTimeout(
    () => {
      try {
        world.noise.disconnect(filter);
        filter.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    },
    Math.max(0, (stopAt - ctx.currentTime) * 1000) + 30,
  );
  return filter;
}

/** Dry click: 1–2 ms noise impulse through a highpass (stands in for a CC0 sample). */
export function playClick(world: SfxWorld, dest: AudioNode, amp: number, when?: number): void {
  playNoise(world, {
    type: 'highpass',
    freq: 2500,
    q: 0.7,
    amp,
    attack: 0.001,
    decay: 0.018,
    when,
    dest,
  });
}
