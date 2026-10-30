import type { Vec3 } from '../../core/math/vec3';
import { createGameAudioContext, getAudioContextCtor } from '../../audio/context';
import { createHrtfPanner, setListenerPose, setPannerPosition } from '../../audio/spatial';
import { createNoiseBuffer } from '../../audio/voices/Drums';
import { EXIT } from './world';

/**
 * Beach ambience lives here (not on the adaptive sequencer) so the dub bass
 * is a positional leak at the construct edge — following it is the exit cue.
 */
export interface BeachAudio {
  unlocked: boolean;
  unlock(): Promise<void>;
  listener(pos: Vec3, forward: Vec3, up: Vec3): void;
  setGains(master: number, ambience: number): void;
  dispose(): void;
}

const BASS_REF = { x: EXIT.x, y: 1.2, z: EXIT.z };

export function createBeachAudio(): BeachAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bassGain: GainNode | null = null;
  let surfGain: GainNode | null = null;
  let windGain: GainNode | null = null;
  let osc: OscillatorNode | null = null;
  let lfo: OscillatorNode | null = null;
  let noiseSrc: AudioBufferSourceNode | null = null;
  let panner: PannerNode | null = null;
  let unlocking: Promise<void> | null = null;

  const api: BeachAudio = {
    unlocked: false,
    async unlock() {
      if (api.unlocked) return;
      unlocking ??= (async () => {
        if (!getAudioContextCtor()) return;
        ctx = createGameAudioContext();
        await ctx.resume();
        master = ctx.createGain();
        master.gain.value = 0.8;
        master.connect(ctx.destination);

        const noise = createNoiseBuffer(ctx, 1.5);
        noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noise;
        noiseSrc.loop = true;

        surfGain = ctx.createGain();
        surfGain.gain.value = 0.22;
        const surfBp = ctx.createBiquadFilter();
        surfBp.type = 'bandpass';
        surfBp.frequency.value = 380;
        surfBp.Q.value = 0.55;
        noiseSrc.connect(surfBp).connect(surfGain).connect(master);

        windGain = ctx.createGain();
        windGain.gain.value = 0.08;
        const windHp = ctx.createBiquadFilter();
        windHp.type = 'highpass';
        windHp.frequency.value = 1600;
        windHp.Q.value = 0.4;
        noiseSrc.connect(windHp).connect(windGain).connect(master);

        panner = createHrtfPanner(ctx, BASS_REF, {
          refDistance: 5,
          maxDistance: 70,
          rolloffFactor: 1.35,
        });
        bassGain = ctx.createGain();
        bassGain.gain.value = 0.0;
        osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 46.25;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 140;
        filt.Q.value = 4;
        lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.125;
        const lfoG = ctx.createGain();
        lfoG.gain.value = 0.16;
        lfo.connect(lfoG).connect(bassGain.gain);
        osc.connect(filt).connect(bassGain).connect(panner).connect(master);

        const t = ctx.currentTime;
        bassGain.gain.setValueAtTime(0.12, t);
        osc.start(t);
        lfo.start(t);
        noiseSrc.start(t);
        api.unlocked = true;
      })();
      await unlocking;
    },
    listener(pos, forward, up) {
      if (!ctx || !panner) return;
      setListenerPose(ctx.listener, pos, forward, up);
      setPannerPosition(panner, BASS_REF);
    },
    setGains(m, ambience) {
      if (!master || !ctx) return;
      const t = ctx.currentTime;
      master.gain.setTargetAtTime(Math.max(0, m), t, 0.05);
      surfGain?.gain.setTargetAtTime(0.22 * ambience, t, 0.08);
      windGain?.gain.setTargetAtTime(0.08 * ambience, t, 0.08);
    },
    dispose() {
      const t = ctx?.currentTime ?? 0;
      try {
        osc?.stop(t + 0.05);
        lfo?.stop(t + 0.05);
        noiseSrc?.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      master?.disconnect();
      void ctx?.close();
      ctx = null;
      api.unlocked = false;
    },
  };
  return api;
}
