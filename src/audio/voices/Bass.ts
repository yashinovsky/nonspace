export interface BassNote {
  freq: number;
  amp?: number;
  type?: OscillatorType;
  cutoff?: number;
  decay?: number;
}

export interface BassVoice {
  noteOn(note: BassNote): void;
  noteOff(): void;
  dispose(): void;
}

/** Square/saw mono bass with a filter envelope (plan §7.2). Retriggers in place. */
export function createBassVoice(ctx: AudioContext, destination: AudioNode): BassVoice {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  osc.type = 'square';
  filter.type = 'lowpass';
  filter.frequency.value = 200;
  filter.Q.value = 6;
  amp.gain.value = 0;
  osc.connect(filter).connect(amp).connect(destination);
  osc.start();

  return {
    noteOn(note) {
      const t = ctx.currentTime;
      const ampLevel = note.amp ?? 0.18;
      const cutoff = note.cutoff ?? 180;
      const decay = note.decay ?? 0.22;
      osc.type = note.type ?? 'square';
      osc.frequency.setValueAtTime(Math.max(20, note.freq), t);
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(cutoff * 6, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff), t + decay);
      amp.gain.cancelScheduledValues(t);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.linearRampToValueAtTime(ampLevel, t + 0.008);
      amp.gain.setTargetAtTime(ampLevel * 0.55, t + 0.008, decay / 3);
    },
    noteOff() {
      const t = ctx.currentTime;
      amp.gain.cancelScheduledValues(t);
      amp.gain.setTargetAtTime(0.0001, t, 0.04);
    },
    dispose() {
      const t = ctx.currentTime;
      amp.gain.setValueAtTime(0, t);
      try {
        osc.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      amp.disconnect();
    },
  };
}
