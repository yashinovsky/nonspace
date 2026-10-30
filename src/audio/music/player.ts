import type { BassVoice } from '../voices/Bass';
import type { DrumVoice } from '../voices/Drums';
import { degreeToHz } from './Harmony';
import { OPEN_FILTER_HZ, type LayerGains } from './patterns';
import type { MusicEvent, Sequencer } from './Sequencer';
import type { MotifVoice } from './motifs';

export interface MusicVoiceSink {
  bass: BassVoice | null;
  drums: DrumVoice | null;
}

export interface MusicPlayer {
  tick(now: number): void;
  addMotif(voice: MotifVoice): void;
  removeMotif(voice: MotifVoice): void;
  setMotifsDominant(on: boolean): void;
  dispose(): void;
}

function oneShotFm(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  amp: number,
  when: number,
  ratio = 2,
  decay = 0.2,
): void {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modG = ctx.createGain();
  const g = ctx.createGain();
  car.type = 'sine';
  mod.type = 'sine';
  car.frequency.setValueAtTime(freq, when);
  mod.frequency.setValueAtTime(freq * ratio, when);
  modG.gain.setValueAtTime(freq * 1.4, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(amp, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  mod.connect(modG).connect(car.frequency);
  car.connect(g).connect(dest);
  car.start(when);
  mod.start(when);
  car.stop(when + decay + 0.05);
  mod.stop(when + decay + 0.05);
}

function startHeld(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  dest: AudioNode,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(dest);
  osc.start();
  return osc;
}

/**
 * Web Audio adapter for the pure sequencer: continuous layer sources, a
 * music-bus filter, and one-shots on the tempo grid.
 */
export function createMusicPlayer(
  ctx: AudioContext,
  dest: AudioNode,
  sequencer: Sequencer,
  sink: MusicVoiceSink,
  noise: AudioNode | null,
): MusicPlayer {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = OPEN_FILTER_HZ;
  filter.Q.value = 0.7;
  filter.connect(dest);

  const layerGain = {
    pad: ctx.createGain(),
    drone: ctx.createGain(),
    growl: ctx.createGain(),
    choir: ctx.createGain(),
    surf: ctx.createGain(),
    wind: ctx.createGain(),
  };
  for (const g of Object.values(layerGain)) {
    g.gain.value = 0;
    g.connect(filter);
  }

  const hz = (degree: number, octave = 0): number =>
    degreeToHz(degree, sequencer.root, sequencer.mode, octave);

  const held: OscillatorNode[] = [];
  const padA = startHeld(ctx, 'sawtooth', hz(0), layerGain.pad);
  const padB = startHeld(ctx, 'sawtooth', hz(2) * 1.003, layerGain.pad);
  const droneOsc = startHeld(ctx, 'sine', hz(0), layerGain.drone);
  const choir = [
    startHeld(ctx, 'sine', hz(0, 1), layerGain.choir),
    startHeld(ctx, 'sine', hz(2, 1), layerGain.choir),
    startHeld(ctx, 'sine', hz(4, 1) * 1.004, layerGain.choir),
  ];
  held.push(padA, padB, droneOsc, ...choir);

  const growlRing = ctx.createGain();
  growlRing.gain.value = 0;
  const growlA = startHeld(ctx, 'sine', 38, growlRing);
  const growlB = startHeld(ctx, 'sine', 41, growlRing);
  growlB.disconnect();
  growlB.connect(growlRing.gain);
  growlRing.connect(layerGain.growl);
  held.push(growlA, growlB);

  const wowLfo = startHeld(ctx, 'sine', 0.18, filter);
  wowLfo.disconnect();
  const wowG = ctx.createGain();
  wowG.gain.value = 0;
  wowLfo.connect(wowG).connect(filter.frequency);
  held.push(wowLfo);

  if (noise) {
    const surfBp = ctx.createBiquadFilter();
    surfBp.type = 'bandpass';
    surfBp.frequency.value = 420;
    surfBp.Q.value = 0.6;
    noise.connect(surfBp).connect(layerGain.surf);
    const windHp = ctx.createBiquadFilter();
    windHp.type = 'highpass';
    windHp.frequency.value = 1800;
    windHp.Q.value = 0.5;
    noise.connect(windHp).connect(layerGain.wind);
  }

  const motifs: MotifVoice[] = [];
  let lastRoot = sequencer.root;
  let lastMode = sequencer.mode;

  const applyHeldFreqs = (now: number): void => {
    if (sequencer.root === lastRoot && sequencer.mode === lastMode) return;
    lastRoot = sequencer.root;
    lastMode = sequencer.mode;
    padA.frequency.setTargetAtTime(hz(0), now, 0.04);
    padB.frequency.setTargetAtTime(hz(2) * 1.003, now, 0.04);
    droneOsc.frequency.setTargetAtTime(hz(0), now, 0.04);
    choir[0]!.frequency.setTargetAtTime(hz(0, 1), now, 0.04);
    choir[1]!.frequency.setTargetAtTime(hz(2, 1), now, 0.04);
    choir[2]!.frequency.setTargetAtTime(hz(4, 1) * 1.004, now, 0.04);
    for (let i = 0; i < motifs.length; i++) motifs[i]!.setKey(sequencer.root, sequencer.mode);
  };

  const applyGains = (g: LayerGains, now: number): void => {
    layerGain.pad.gain.setTargetAtTime(g.pad * 0.08, now, 0.03);
    layerGain.drone.gain.setTargetAtTime(g.drone * 0.07, now, 0.03);
    layerGain.growl.gain.setTargetAtTime(g.growl * 0.12, now, 0.03);
    layerGain.choir.gain.setTargetAtTime(g.choir * 0.05, now, 0.04);
    layerGain.surf.gain.setTargetAtTime(g.surf * 0.2, now, 0.05);
    layerGain.wind.gain.setTargetAtTime(g.wind * 0.12, now, 0.05);
    wowG.gain.setTargetAtTime(g.choir > 0.01 ? 90 : 0, now, 0.08);
    growlRing.gain.setTargetAtTime(g.growl > 0.01 ? 0.6 : 0, now, 0.05);
  };

  const playEvent = (e: MusicEvent): void => {
    switch (e.kind) {
      case 'arp':
        oneShotFm(ctx, filter, e.freq, e.amp * 0.09, e.time, 3.5, 0.28);
        break;
      case 'bass':
        sink.bass?.noteOn({ freq: e.freq, amp: e.amp * 0.22, when: e.time });
        break;
      case 'dubBass':
        sink.bass?.noteOn({
          freq: e.freq,
          amp: e.amp * 0.16,
          type: 'sine',
          decay: 0.45,
          when: e.time,
        });
        break;
      case 'hat':
        sink.drums?.hat(e.amp * 0.12, e.open, e.time);
        break;
      case 'kick':
        sink.drums?.kick(e.amp * 0.35, e.time);
        break;
      case 'snare':
        sink.drums?.snare(e.amp * 0.22, e.time);
        break;
      case 'heartbeat':
        oneShotFm(ctx, dest, 48, e.amp * 0.2, e.time, 1, 0.16);
        break;
    }
  };

  return {
    tick(now) {
      const { events, steps } = sequencer.tick(now, 0.12);
      applyGains(sequencer.gainsAt(now), now);
      filter.frequency.setTargetAtTime(sequencer.filterHzAt(now), now, 0.05);
      applyHeldFreqs(now);
      for (let i = 0; i < events.length; i++) playEvent(events[i]!);
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i]!;
        for (let m = 0; m < motifs.length; m++) motifs[m]!.step(st.index, st.bar, st.time);
      }
      for (let m = 0; m < motifs.length; m++) motifs[m]!.poll(now);
    },
    addMotif(voice) {
      motifs.push(voice);
    },
    removeMotif(voice) {
      const i = motifs.indexOf(voice);
      if (i >= 0) motifs.splice(i, 1);
    },
    setMotifsDominant(on) {
      for (let i = 0; i < motifs.length; i++) motifs[i]!.setDominant(on);
    },
    dispose() {
      const t = ctx.currentTime;
      for (const osc of held) {
        try {
          osc.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
      }
      filter.disconnect();
      motifs.length = 0;
    },
  };
}
