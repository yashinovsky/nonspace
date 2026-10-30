import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createNoopAudioEngine, type AudioEngine } from '../../src/audio/AudioEngine';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { SOFTS } from '../../src/content/softs';
import { iceLayerDefSchema } from '../../src/narrative/schema';
import { Beam, BeamFlag, createLineSet, lineSetCount } from '../../src/render/lines/BeamBatch';
import { createPalette, hexToRgb, type Rgb } from '../../src/render/palette';
import {
  createRecordingAudioEngine,
  createRecordingBeamBatch,
  createRecordingPointBatch,
} from '../../src/testing/mocks';
import { sampleBlackIceDef, sampleIceDef, sampleTimeline } from '../../src/testing/fixtures';

describe('render contracts', () => {
  it('createLineSet sizes arrays per segment', () => {
    const set = createLineSet(10, { width: true, flags: true });
    expect(set.positions.length).toBe(60);
    expect(lineSetCount(set)).toBe(10);
    expect(set.width?.[0]).toBe(1.5);
    expect(set.intensity[9]).toBe(1);
  });

  it('recording beam batch accepts THREE.Vector3 and records pushes', () => {
    const batch = createRecordingBeamBatch(2);
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    batch.beginDynamic();
    batch.push(a, b, Beam.ESFA, 4, 2, BeamFlag.DWELL | BeamFlag.NO_FOG);
    batch.push(a, b, Beam.GRID);
    batch.push(a, b, Beam.GRID);
    batch.endDynamic();
    expect(batch.dynamicCount).toBe(2);
    expect(batch.overflow).toBe(1);
    expect(Array.from(batch.dynamic.positions.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(batch.dynamic.color[0]).toBe(Beam.ESFA);
    expect(batch.dynamic.flags[0]).toBe(BeamFlag.DWELL | BeamFlag.NO_FOG);
    expect(batch.dynamic.width[1]).toBe(1.5);
    expect(batch.frames).toBe(1);
  });

  it('recording point batch records pushes', () => {
    const batch = createRecordingPointBatch(4);
    batch.beginDynamic();
    batch.push({ x: 1, y: 2, z: 3 }, Beam.AMBER, 2);
    batch.endDynamic();
    expect(batch.dynamicCount).toBe(1);
    expect(batch.dynamic.size[0]).toBe(1.5);
  });

  it('palette exposes §5.3 defaults and reversible global effects', () => {
    const palette = createPalette();
    const out = { r: 0, g: 0, b: 0 };
    const expectRgb = (actual: Rgb, expected: Rgb): void => {
      expect(actual.r).toBeCloseTo(expected.r, 6);
      expect(actual.g).toBeCloseTo(expected.g, 6);
      expect(actual.b).toBeCloseTo(expected.b, 6);
    };
    expectRgb(palette.get(Beam.AMBER, out), hexToRgb(0xffb000));

    palette.lerpAllTo({ r: 1, g: 1, b: 1 }, 1);
    expectRgb(palette.get(Beam.ESFA, out), { r: 1, g: 1, b: 1 });

    palette.lerpAllTo({ r: 1, g: 1, b: 1 }, 0);
    palette.addWarmth(0);
    expectRgb(palette.get(Beam.ESFA, out), hexToRgb(0xff3b1f));
    expect(palette.uniform.value.length).toBe(24);
  });
});

describe('content contracts', () => {
  it('ICE presets validate against the layer schema', () => {
    for (const preset of Object.values(ICE_LAYER_PRESETS)) {
      expect(() => iceLayerDefSchema.parse(preset)).not.toThrow();
    }
  });

  it('only black ICE grips', () => {
    expect(ICE_LAYER_PRESETS['black-1'].grip).toEqual({ neuralThreshold: 60, seconds: 8 });
    expect('grip' in ICE_LAYER_PRESETS['gray-3']).toBe(false);
  });

  it('fixtures return fresh copies', () => {
    const a = sampleIceDef();
    a.layers[0]!.tolRatio = 99;
    expect(sampleIceDef().layers[0]!.tolRatio).toBe(0.1);
    expect(sampleBlackIceDef().layers).toHaveLength(2);
    expect(sampleTimeline().clockStart).toBe('02:14:07');
  });

  it('softs have unique ids', () => {
    expect(new Set(SOFTS.map((s) => s.id)).size).toBe(SOFTS.length);
  });
});

describe('audio contract', () => {
  it('no-op engine implements the full API without a device', async () => {
    const audio: AudioEngine = createNoopAudioEngine();
    await expect(audio.unlock()).resolves.toBeUndefined();
    audio.sfx('scan', { pos: { x: 0, y: 0, z: 0 } });
    audio.music.setState('breach');
    const h1 = audio.motif.attach('esfa', { x: 0, y: 0, z: 0 }, 'esfa');
    const h2 = audio.motif.attach('ta', { x: 0, y: 0, z: 0 }, 'tessierAshpool');
    expect(h1).not.toBe(h2);
    audio.motif.detach(h1);
    audio.phaseLock.start(2, 3, 110);
    audio.duck('music', -24, 0.5);
  });

  it('recording engine logs calls by dotted path', () => {
    const { engine, calls, callsTo } = createRecordingAudioEngine();
    engine.sfx('shatter');
    engine.phaseLock.setPlayer(1.5, 0.2);
    engine.phaseLock.setPlayer(1.4, 0.1);
    expect(calls[0]).toEqual({ method: 'sfx', args: ['shatter'] });
    expect(callsTo('phaseLock.setPlayer')).toHaveLength(2);
  });
});
