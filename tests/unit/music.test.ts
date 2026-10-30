import { describe, expect, it } from 'vitest';
import { MUSIC_STATES } from '../../src/audio/AudioEngine';
import {
  DEFAULT_ROOT_MIDI,
  hzToMidi,
  isInKey,
  midiToHz,
  phaseLockTones,
  quantizeHz,
  SCALE_DEGREES,
} from '../../src/audio/music/Harmony';
import { CORP_MOTIFS, motifDistanceGain, shouldAttachMotif } from '../../src/audio/music/motifs';
import { PATTERNS } from '../../src/audio/music/patterns';
import {
  barDuration,
  beatDuration,
  createSequencer,
  createTempoClock,
  DEFAULT_BPM,
  nearestBeatTime,
  pulse,
  STEPS_PER_BAR,
} from '../../src/audio/music/Sequencer';
import { DEFAULT_PANNER } from '../../src/audio/spatial';
import { CORP_IDS } from '../../src/content/corps';

describe('Harmony', () => {
  it('keeps A4 at 440 Hz and the default root on A2', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 10);
    expect(midiToHz(DEFAULT_ROOT_MIDI)).toBeCloseTo(110, 8);
    expect(hzToMidi(440)).toBeCloseTo(69, 10);
  });

  it('reports every scale degree as in-key', () => {
    for (const mode of ['minor', 'dorian', 'lydian'] as const) {
      for (const deg of SCALE_DEGREES[mode]) {
        expect(isInKey(DEFAULT_ROOT_MIDI + deg, DEFAULT_ROOT_MIDI, mode)).toBe(true);
      }
      expect(isInKey(DEFAULT_ROOT_MIDI + 1, DEFAULT_ROOT_MIDI, mode)).toBe(false);
    }
  });

  it('quantizes out-of-key Phase Lock partials onto the mission key', () => {
    const on = phaseLockTones(2, 3, 110, DEFAULT_ROOT_MIDI, 'minor');
    expect(isInKey(hzToMidi(on.iceA), DEFAULT_ROOT_MIDI, 'minor')).toBe(true);
    expect(isInKey(hzToMidi(on.iceB), DEFAULT_ROOT_MIDI, 'minor')).toBe(true);
    expect(isInKey(hzToMidi(on.player), DEFAULT_ROOT_MIDI, 'minor')).toBe(true);

    const off = phaseLockTones(2, 3, 100, DEFAULT_ROOT_MIDI, 'dorian');
    expect(isInKey(hzToMidi(off.f0), DEFAULT_ROOT_MIDI, 'dorian')).toBe(true);
    expect(isInKey(hzToMidi(off.iceA), DEFAULT_ROOT_MIDI, 'dorian')).toBe(true);
    expect(isInKey(hzToMidi(off.iceB), DEFAULT_ROOT_MIDI, 'dorian')).toBe(true);
    expect(Math.abs(quantizeHz(100, DEFAULT_ROOT_MIDI, 'dorian') - off.f0)).toBeLessThan(1e-6);
  });
});

describe('pulse / tempo clock', () => {
  it('peaks on every beat and is within ±10 ms of the sequencer grid', () => {
    const clock = createTempoClock(DEFAULT_BPM, 0);
    const beat = beatDuration(DEFAULT_BPM);
    expect(pulse(0, clock)).toBeCloseTo(1, 8);
    expect(pulse(beat, clock)).toBeCloseTo(1, 8);
    expect(pulse(beat * 2, clock)).toBeCloseTo(1, 8);
    expect(pulse(beat / 2, clock)).toBeLessThan(0.05);

    const seq = createSequencer({ now: () => 0, rng: () => 0 });
    seq.setState('approach', 0);
    const { events } = seq.tick(0, barDuration(DEFAULT_BPM));
    const onBeat = events.filter((e) => e.kind === 'bass' || e.kind === 'kick');
    expect(onBeat.length).toBeGreaterThan(0);
    for (const e of onBeat) {
      expect(Math.abs(e.time - nearestBeatTime(e.time, seq.clock))).toBeLessThan(0.01);
      expect(pulse(e.time, seq.clock)).toBeGreaterThan(0.99);
    }
  });

  it('pulse(t) with a bpm number uses origin 0', () => {
    expect(pulse(0, 128)).toBeCloseTo(1, 8);
    expect(pulse(60 / 128 / 2, 128)).toBeLessThan(0.05);
  });
});

describe('Sequencer crossfade and patterns', () => {
  it('has a pattern for every music state', () => {
    for (const state of MUSIC_STATES) {
      expect(PATTERNS[state].state).toBe(state);
    }
  });

  it('crossfades state changes within one bar', () => {
    const seq = createSequencer({ now: () => 0, rng: () => 0 });
    seq.setState('transit', 0);
    const bar = barDuration(seq.clock.bpm);
    seq.setState('approach', bar);
    const fade = seq.crossfadeAt(bar);
    expect(fade).not.toBeNull();
    expect(fade!.duration).toBeCloseTo(bar, 8);
    expect(fade!.duration).toBeLessThanOrEqual(bar + 1e-9);
    expect(seq.gainsAt(bar).bass).toBeCloseTo(0, 5);
    expect(seq.gainsAt(bar + bar / 2).bass).toBeGreaterThan(0.3);
    expect(seq.gainsAt(bar + bar / 2).pad).toBeGreaterThan(0.3);
    expect(seq.gainsAt(bar + bar).bass).toBeCloseTo(
      PATTERNS.approach.layers.find((l) => l.id === 'bass')!.gain,
      5,
    );
    expect(seq.crossfadeAt(bar + bar)).toBeNull();
  });

  it('applies kuangDive tempo unless setTempo locked it', () => {
    const seq = createSequencer({ rng: () => 0 });
    seq.setState('kuangDive', 0);
    expect(seq.clock.bpm).toBe(128);
    seq.setTempo(100, 0);
    seq.setState('kuangDive', 0);
    expect(seq.clock.bpm).toBe(100);
  });

  it('low-passes simstim and ducks grip', () => {
    const seq = createSequencer({ rng: () => 0 });
    seq.setState('simstim', 0);
    const bar = barDuration(seq.clock.bpm);
    expect(seq.filterHzAt(bar)).toBe(PATTERNS.simstim.filterHz);
    seq.setState('grip', bar);
    expect(seq.duckDb()).toBe(-24);
    expect(seq.gainsAt(bar + bar).growl).toBeCloseTo(PATTERNS.grip.layers[0]!.gain, 5);
  });

  it('scales breach percussion with the lock meter', () => {
    const horizon = barDuration(DEFAULT_BPM);
    const seq = createSequencer({ now: () => 0, rng: () => 0 });
    seq.lockMeter = 0;
    seq.setState('breach', 0);
    const quiet = seq.tick(0, horizon).events.filter((e) => e.kind === 'hat');
    const seq2 = createSequencer({ now: () => 0, rng: () => 0 });
    seq2.lockMeter = 1;
    seq2.setState('breach', 0);
    const loud = seq2.tick(0, horizon).events.filter((e) => e.kind === 'hat');
    expect(quiet.length).toBeGreaterThan(0);
    expect(loud.length).toBeGreaterThan(0);
    expect(Math.max(...loud.map((e) => e.amp))).toBeGreaterThan(
      Math.max(...quiet.map((e) => e.amp)),
    );
  });

  it('schedules 16th-grid steps without skipping a bar', () => {
    const seq = createSequencer({ now: () => 0, rng: () => 0 });
    seq.setState('kuangDive', 0);
    const { steps } = seq.tick(0, barDuration(seq.clock.bpm) - 1e-6);
    expect(steps).toHaveLength(STEPS_PER_BAR);
    expect(steps[0]!.index).toBe(0);
    expect(steps[15]!.index).toBe(15);
  });
});

describe('corp motifs', () => {
  it('defines a motif for every corp and detaches with distance', () => {
    for (const corp of CORP_IDS) {
      expect(CORP_MOTIFS[corp].corp).toBe(corp);
    }
    expect(motifDistanceGain(0)).toBe(1);
    expect(motifDistanceGain(DEFAULT_PANNER.refDistance)).toBe(1);
    expect(motifDistanceGain(DEFAULT_PANNER.refDistance * 2)).toBeCloseTo(0.5, 5);
    expect(motifDistanceGain(DEFAULT_PANNER.maxDistance)).toBe(0);
    expect(motifDistanceGain(DEFAULT_PANNER.maxDistance + 10)).toBe(0);
    expect(shouldAttachMotif(DEFAULT_PANNER.refDistance)).toBe(true);
    expect(shouldAttachMotif(DEFAULT_PANNER.maxDistance)).toBe(false);
  });
});
