import { BoxGeometry, Group, MeshBasicMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  STRAYLIGHT_INJURY_AT,
  STRAYLIGHT_M5_GATES,
  STRAYLIGHT_M7_GATES,
  STRAYLIGHT_WORD,
  straylightM5Timeline,
  straylightM7Timeline,
} from '../../src/content/simstim/straylight';
import { buildStraylight } from '../../src/content/simstim/straylightScene';
import { mockM5Mission, mockM7Mission } from '../../src/narrative/mocks';
import { createSimstimKit, SCENE_TRI_CAP, zoneTotal } from '../../src/render/simstim/kit';
import { parseSimstimScene } from '../../src/debug/SimstimLab';
import { createMollyTimeline } from '../../src/simstim/MollyTimeline';
import { SIM_DT } from '../../src/core/loop';

function kit() {
  return createSimstimKit({
    root: new Group(),
    figures: new Map(),
    boxGeom: new BoxGeometry(1, 1, 1),
    planeGeom: new PlaneGeometry(1, 1),
    material: () => new MeshBasicMaterial(),
  });
}

describe('M6.3 Straylight content', () => {
  it('authors M5 gates, injury beat, and mannequins', () => {
    const def = straylightM5Timeline();
    expect(def.id).toBe('straylight-m5');
    expect(def.scene).toBe('straylight');
    expect(def.clockStart).toBe('04:12:00');
    expect(STRAYLIGHT_M5_GATES.map((g) => g.id)).toEqual([
      'hall-arch',
      'stair-gate',
      'gallery-door',
    ]);
    expect(STRAYLIGHT_INJURY_AT).toBe(8);
    expect(def.figures.map((f) => f.id).sort()).toEqual(['hideo', 'jane', 'riviera']);
    const molly = def.lines.filter((l) => l.who === 'molly');
    expect(molly.length).toBeGreaterThanOrEqual(5);
    expect(molly.every((l) => l.text.split(/\s+/).length <= 3)).toBe(true);
    expect(molly.some((l) => l.text.includes('Leg'))).toBe(true);
  });

  it('authors the M7 word scene', () => {
    const def = straylightM7Timeline();
    expect(def.id).toBe('straylight-m7');
    expect(def.scene).toBe('straylight');
    expect(def.clockStart).toBe('04:41:08');
    expect(STRAYLIGHT_M7_GATES.map((g) => g.id)).toEqual(['head-seal', 'word-window']);
    expect(def.lines.some((l) => l.who === '3jane' && l.text === STRAYLIGHT_WORD)).toBe(true);
    expect(STRAYLIGHT_WORD.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it('matches the campaign M5 and ?mission=m7 stub gates', () => {
    const m5 = mockM5Mission();
    expect(m5.id).toBe('m5');
    expect(m5.simstim?.timeline).toBe('straylight-m5');
    expect(m5.simstim?.gates.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`)).toEqual(
      STRAYLIGHT_M5_GATES.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`),
    );
    const m7 = mockM7Mission();
    expect(m7.id).toBe('m7');
    expect(m7.simstim?.timeline).toBe('straylight-m7');
    expect(m7.simstim?.gates.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`)).toEqual(
      STRAYLIGHT_M7_GATES.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`),
    );
  });

  it('keeps each villa zone under 3k tris', () => {
    const k = kit();
    buildStraylight(k);
    expect(k.stats.hall).toBeGreaterThan(80);
    expect(k.stats.stair).toBeGreaterThan(80);
    expect(k.stats.gallery).toBeGreaterThan(40);
    expect(k.stats.head).toBeGreaterThan(40);
    expect(k.stats.hall).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(k.stats.stair).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(k.stats.gallery).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(k.stats.head).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(zoneTotal(k.stats)).toBeLessThanOrEqual(SCENE_TRI_CAP * 4);
    expect(k.figures.has('jane')).toBe(true);
    expect(k.figures.has('hideo')).toBe(true);
    expect(k.figures.has('riviera')).toBe(true);
    expect(k.figures.has('cameo')).toBe(true);
  });

  it('drops the camera at the injury beat and unhides 3Jane later', () => {
    const tl = createMollyTimeline();
    tl.load(straylightM5Timeline());
    const step = SIM_DT;
    for (let t = 0; t < STRAYLIGHT_INJURY_AT - 0.4; t += step) tl.update(step, t, null);
    const before = tl.sample();
    expect(before.camera.pos.y).toBeGreaterThan(1.4);
    expect(before.figures.find((f) => f.id === 'jane')?.pose).toBe('hidden');

    for (let t = STRAYLIGHT_INJURY_AT - 0.4; t < STRAYLIGHT_INJURY_AT + 0.7; t += step) {
      tl.update(step, t, null);
    }
    const hurt = tl.sample();
    expect(hurt.camera.pos.y).toBeLessThan(1.2);
    expect(hurt.clock.startsWith('04:12:')).toBe(true);

    for (let t = STRAYLIGHT_INJURY_AT + 0.7; t < 16; t += step) tl.update(step, t, null);
    const after = tl.sample();
    expect(after.figures.find((f) => f.id === 'jane')?.pose).not.toBe('hidden');
  });

  it('parses straylight lab scenes without stealing Sense/Net', () => {
    expect(parseSimstimScene(null)).toBe('sensenet');
    expect(parseSimstimScene('lab')).toBe('lab');
    expect(parseSimstimScene('straylight')).toBe('straylight');
    expect(parseSimstimScene('straylight-m7')).toBe('straylight-m7');
    expect(parseSimstimScene('m5')).toBe('straylight');
  });

  it('fires the word once as M7 playback crosses it', () => {
    const tl = createMollyTimeline();
    tl.load(straylightM7Timeline());
    const seen: string[] = [];
    for (let i = 0; i < 14 / SIM_DT; i++) {
      tl.update(SIM_DT, (i + 1) * SIM_DT, null);
      for (const line of tl.firedLines) seen.push(`${line.who}:${line.text}`);
    }
    expect(seen).toContain(`3jane:${STRAYLIGHT_WORD}`);
    expect(seen).toContain('molly:The head.');
    expect(new Set(seen).size).toBe(seen.length);
  });
});
