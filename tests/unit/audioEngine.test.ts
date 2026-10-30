import { describe, expect, it } from 'vitest';
import {
  createAudioEngine,
  createNoopAudioEngine,
  disposeAudioEngine,
  getAudioDiagnostics,
  type AudioEngine,
} from '../../src/audio/AudioEngine';
import { createRecordingAudioEngine } from '../../src/testing/mocks';

describe('no-op and recording doubles', () => {
  it('no-op still implements the full API without a device', async () => {
    const audio: AudioEngine = createNoopAudioEngine();
    await expect(audio.unlock()).resolves.toBeUndefined();
    audio.sfx('scan', { pos: { x: 0, y: 0, z: 0 } });
    audio.music.setState('breach');
    audio.music.setTempo(128);
    audio.music.setKey(45, 'dorian');
    const h1 = audio.motif.attach('esfa', { x: 0, y: 0, z: 0 }, 'esfa');
    const h2 = audio.motif.attach('ta', { x: 0, y: 0, z: 0 }, 'tessierAshpool');
    expect(h1).not.toBe(h2);
    audio.motif.detach(h1);
    audio.phaseLock.start(2, 3, 110);
    audio.phaseLock.setTarget(3, 4, 0.1);
    audio.phaseLock.setPlayer(1.5, 0.2);
    audio.phaseLock.stop();
    audio.modem.start();
    audio.modem.stop();
    audio.duck('music', -24, 0.5);
    audio.listener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  });

  it('recording engine still logs dotted paths through the no-op', () => {
    const { engine, calls, callsTo } = createRecordingAudioEngine();
    engine.sfx('shatter');
    engine.phaseLock.setPlayer(1.5, 0.2);
    engine.phaseLock.setPlayer(1.4, 0.1);
    engine.duck('all', -12, 1);
    expect(calls[0]).toEqual({ method: 'sfx', args: ['shatter'] });
    expect(callsTo('phaseLock.setPlayer')).toHaveLength(2);
    expect(callsTo('duck')[0]).toEqual({ method: 'duck', args: ['all', -12, 1] });
  });
});

describe('createAudioEngine (no audio device)', () => {
  it('is safe to call before unlock and records pending motifs', async () => {
    const audio = createAudioEngine();
    expect(getAudioDiagnostics(audio)?.unlocked).toBe(false);
    audio.sfx('jackIn');
    audio.music.setState('transit');
    audio.music.setTempo(110);
    audio.music.setKey(57, 'lydian');
    audio.duck('all', -6, 0.2);
    audio.listener({ x: 9, y: 8, z: 7 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    const h1 = audio.motif.attach('lab', { x: 10, y: 0, z: 0 }, 'mitsubishi');
    const h2 = audio.motif.attach('lab2', { x: 0, y: 0, z: 10 }, 'turing');
    expect(h1).not.toBe(h2);
    expect(getAudioDiagnostics(audio)?.motifCount).toBe(2);
    audio.motif.detach(h1);
    expect(getAudioDiagnostics(audio)?.motifCount).toBe(1);
    await expect(audio.unlock()).resolves.toBeUndefined();
    const diag = getAudioDiagnostics(audio);
    expect(diag?.music).toEqual({ state: 'transit', bpm: 110, root: 57, mode: 'lydian' });
    disposeAudioEngine(audio);
  });

  it('dispose is a no-op on the silent engine', () => {
    const noop = createNoopAudioEngine();
    expect(getAudioDiagnostics(noop)).toBeNull();
    disposeAudioEngine(noop);
  });
});
