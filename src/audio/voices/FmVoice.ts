import { allocVoice, countActive, type VoiceSlot } from '../dsp/alloc';
import { FM_VOICE_COUNT, type FmWorkletMessage } from '../dsp/fm';
import { FM_WORKLET_NAME } from '../worklets/fm.worklet';

export interface FmNote {
  freq: number;
  amp?: number;
  ratio?: number;
  index?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  pan?: number;
}

export interface FmVoicePool {
  readonly size: number;
  readonly usingWorklet: boolean;
  active(): number;
  noteOn(note: FmNote): number;
  noteOff(index: number): void;
  allOff(): void;
  dispose(): void;
}

interface OscVoice {
  car: OscillatorNode;
  mod: OscillatorNode;
  modGain: GainNode;
  amp: GainNode;
  pan: StereoPannerNode;
}

/**
 * 16-voice 2-operator FM pool. Prefers the `ns-fm` worklet; falls back to
 * OscillatorNode pairs if addModule failed (still 16 simultaneous voices).
 */
export function createFmVoicePool(
  ctx: AudioContext,
  destination: AudioNode,
  workletReady: boolean,
  size = FM_VOICE_COUNT,
): FmVoicePool {
  const slots: VoiceSlot[] = Array.from({ length: size }, () => ({
    active: false,
    amp: 0,
    startedAt: 0,
  }));
  let clock = 1;

  if (workletReady) {
    const node = new AudioWorkletNode(ctx, FM_WORKLET_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(destination);
    const post = (msg: FmWorkletMessage): void => {
      node.port.postMessage(msg);
    };
    return {
      size,
      usingWorklet: true,
      active: () => countActive(slots),
      noteOn(note) {
        const i = allocVoice(slots, clock++);
        slots[i]!.amp = note.amp ?? 0.12;
        post({
          type: 'on',
          i,
          freq: note.freq,
          amp: note.amp ?? 0.12,
          ratio: note.ratio ?? 2,
          index: note.index ?? 1.8,
          attack: note.attack ?? 0.005,
          decay: note.decay ?? 0.08,
          sustain: note.sustain ?? 0.55,
          release: note.release ?? 0.12,
          pan: note.pan ?? 0,
        });
        return i;
      },
      noteOff(index) {
        const s = slots[index];
        if (!s?.active) return;
        s.active = false;
        post({ type: 'off', i: index });
      },
      allOff() {
        for (const s of slots) s.active = false;
        post({ type: 'allOff' });
      },
      dispose() {
        post({ type: 'allOff' });
        node.disconnect();
      },
    };
  }

  const oscs: OscVoice[] = [];
  for (let i = 0; i < size; i++) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const amp = ctx.createGain();
    const pan = ctx.createStereoPanner();
    car.type = 'sine';
    mod.type = 'sine';
    amp.gain.value = 0;
    modGain.gain.value = 0;
    mod.connect(modGain).connect(car.frequency);
    car.connect(amp).connect(pan).connect(destination);
    car.start();
    mod.start();
    oscs.push({ car, mod, modGain, amp, pan });
  }

  const envOn = (voice: OscVoice, note: FmNote, t: number): void => {
    const amp = note.amp ?? 0.12;
    const attack = note.attack ?? 0.005;
    const decay = note.decay ?? 0.08;
    const sustain = (note.sustain ?? 0.55) * amp;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(0.0001, t);
    voice.amp.gain.linearRampToValueAtTime(amp, t + attack);
    voice.amp.gain.setTargetAtTime(Math.max(0.0001, sustain), t + attack, decay / 3);
  };

  return {
    size,
    usingWorklet: false,
    active: () => countActive(slots),
    noteOn(note) {
      const i = allocVoice(slots, clock++);
      slots[i]!.amp = note.amp ?? 0.12;
      const voice = oscs[i]!;
      const t = ctx.currentTime;
      const freq = Math.max(20, note.freq);
      const ratio = note.ratio ?? 2;
      const index = note.index ?? 1.8;
      voice.car.frequency.setValueAtTime(freq, t);
      voice.mod.frequency.setValueAtTime(freq * ratio, t);
      voice.modGain.gain.setValueAtTime(freq * index, t);
      voice.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, note.pan ?? 0)), t);
      envOn(voice, note, t);
      return i;
    },
    noteOff(index) {
      const s = slots[index];
      if (!s?.active) return;
      s.active = false;
      const voice = oscs[index];
      if (!voice) return;
      const t = ctx.currentTime;
      const release = 0.12;
      voice.amp.gain.cancelScheduledValues(t);
      voice.amp.gain.setTargetAtTime(0.0001, t, release / 3);
    },
    allOff() {
      const t = ctx.currentTime;
      for (let i = 0; i < size; i++) {
        slots[i]!.active = false;
        const voice = oscs[i]!;
        voice.amp.gain.cancelScheduledValues(t);
        voice.amp.gain.setTargetAtTime(0.0001, t, 0.04);
      }
    },
    dispose() {
      const t = ctx.currentTime;
      for (const voice of oscs) {
        voice.amp.gain.setValueAtTime(0, t);
        try {
          voice.car.stop(t + 0.05);
          voice.mod.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
        voice.pan.disconnect();
      }
    },
  };
}
