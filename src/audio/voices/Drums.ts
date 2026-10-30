import { createNoiseState, expSweep, tickNoise } from '../dsp/noise';

export interface DrumVoice {
  kick(amp?: number): void;
  snare(amp?: number): void;
  hat(amp?: number, open?: boolean): void;
  dispose(): void;
}

export function createNoiseBuffer(ctx: AudioContext, seconds = 1): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const state = createNoiseState(0xc0ffee, 0);
  for (let i = 0; i < n; i++) d[i] = tickNoise(state);
  return buf;
}

function env(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/**
 * Analog drums (plan §7.2): kick = pitched sine, snare = noise + tone,
 * hats = filtered noise. `noise` is a running source (worklet or buffer loop).
 */
export function createDrumVoice(
  ctx: AudioContext,
  destination: AudioNode,
  noise: AudioNode,
): DrumVoice {
  const kickOsc = ctx.createOscillator();
  const kickAmp = ctx.createGain();
  kickOsc.type = 'sine';
  kickAmp.gain.value = 0;
  kickOsc.connect(kickAmp).connect(destination);
  kickOsc.start();

  const snareBp = ctx.createBiquadFilter();
  snareBp.type = 'bandpass';
  snareBp.frequency.value = 1800;
  snareBp.Q.value = 1.2;
  const snareAmp = ctx.createGain();
  snareAmp.gain.value = 0;
  noise.connect(snareBp).connect(snareAmp).connect(destination);

  const snareTone = ctx.createOscillator();
  const snareToneAmp = ctx.createGain();
  snareTone.type = 'triangle';
  snareTone.frequency.value = 180;
  snareToneAmp.gain.value = 0;
  snareTone.connect(snareToneAmp).connect(destination);
  snareTone.start();

  const hatHp = ctx.createBiquadFilter();
  hatHp.type = 'highpass';
  hatHp.frequency.value = 7000;
  hatHp.Q.value = 0.7;
  const hatAmp = ctx.createGain();
  hatAmp.gain.value = 0;
  noise.connect(hatHp).connect(hatAmp).connect(destination);

  return {
    kick(amp = 0.4) {
      const t = ctx.currentTime;
      kickOsc.frequency.cancelScheduledValues(t);
      kickOsc.frequency.setValueAtTime(150, t);
      kickOsc.frequency.exponentialRampToValueAtTime(38, t + 0.15);
      env(kickAmp, t, amp, 0.004, 0.18);
    },
    snare(amp = 0.25) {
      const t = ctx.currentTime;
      env(snareAmp, t, amp, 0.002, 0.12);
      env(snareToneAmp, t, amp * 0.35, 0.002, 0.08);
    },
    hat(amp = 0.12, open = false) {
      const t = ctx.currentTime;
      env(hatAmp, t, amp, 0.001, open ? 0.18 : 0.04);
    },
    dispose() {
      const t = ctx.currentTime;
      kickAmp.gain.setValueAtTime(0, t);
      snareAmp.gain.setValueAtTime(0, t);
      hatAmp.gain.setValueAtTime(0, t);
      try {
        kickOsc.stop(t + 0.05);
        snareTone.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      kickAmp.disconnect();
      snareAmp.disconnect();
      hatAmp.disconnect();
    },
  };
}

export { expSweep };
