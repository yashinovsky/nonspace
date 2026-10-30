import { allocVoice, countActive, type VoiceSlot } from '../dsp/alloc';

export interface SubNote {
  freq: number;
  amp?: number;
  type?: OscillatorType;
  cutoff?: number;
  resonance?: number;
  cutoffEnv?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export interface SubVoicePool {
  readonly size: number;
  active(): number;
  noteOn(note: SubNote): number;
  noteOff(index: number): void;
  allOff(): void;
  dispose(): void;
}

interface SubVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  amp: GainNode;
}

/** Subtractive poly: saw/pulse → resonant low-pass with a slow envelope (plan §7.2). */
export function createSubVoicePool(
  ctx: AudioContext,
  destination: AudioNode,
  size = 6,
): SubVoicePool {
  const slots: VoiceSlot[] = Array.from({ length: size }, () => ({
    active: false,
    amp: 0,
    startedAt: 0,
  }));
  let clock = 1;
  const voices: SubVoice[] = [];
  for (let i = 0; i < size; i++) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    osc.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 4;
    amp.gain.value = 0;
    osc.connect(filter).connect(amp).connect(destination);
    osc.start();
    voices.push({ osc, filter, amp });
  }

  return {
    size,
    active: () => countActive(slots),
    noteOn(note) {
      const i = allocVoice(slots, clock++);
      const amp = note.amp ?? 0.1;
      slots[i]!.amp = amp;
      const v = voices[i]!;
      const t = ctx.currentTime;
      const attack = note.attack ?? 0.08;
      const decay = note.decay ?? 0.4;
      const sustain = (note.sustain ?? 0.7) * amp;
      const cutoff = note.cutoff ?? 600;
      const cutoffEnv = note.cutoffEnv ?? 1800;
      v.osc.type = note.type ?? 'sawtooth';
      v.osc.frequency.setValueAtTime(Math.max(20, note.freq), t);
      v.filter.Q.setValueAtTime(note.resonance ?? 5, t);
      v.filter.frequency.cancelScheduledValues(t);
      v.filter.frequency.setValueAtTime(cutoff + cutoffEnv, t);
      v.filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff), t + decay);
      v.amp.gain.cancelScheduledValues(t);
      v.amp.gain.setValueAtTime(0.0001, t);
      v.amp.gain.linearRampToValueAtTime(amp, t + attack);
      v.amp.gain.setTargetAtTime(Math.max(0.0001, sustain), t + attack, decay / 3);
      return i;
    },
    noteOff(index) {
      const s = slots[index];
      if (!s?.active) return;
      s.active = false;
      const v = voices[index];
      if (!v) return;
      const t = ctx.currentTime;
      const release = 0.35;
      v.amp.gain.cancelScheduledValues(t);
      v.amp.gain.setTargetAtTime(0.0001, t, release / 3);
    },
    allOff() {
      const t = ctx.currentTime;
      for (let i = 0; i < size; i++) {
        slots[i]!.active = false;
        voices[i]!.amp.gain.cancelScheduledValues(t);
        voices[i]!.amp.gain.setTargetAtTime(0.0001, t, 0.08);
      }
    },
    dispose() {
      const t = ctx.currentTime;
      for (const v of voices) {
        v.amp.gain.setValueAtTime(0, t);
        try {
          v.osc.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
        v.amp.disconnect();
      }
    },
  };
}
