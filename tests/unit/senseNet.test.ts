import { BoxGeometry, Group, MeshBasicMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  SENSE_NET_GATES,
  SENSE_NET_PANIC_AT,
  senseNetTimeline,
} from '../../src/content/simstim/senseNet';
import { buildSenseNet } from '../../src/content/simstim/senseNetScene';
import { mockM2Mission } from '../../src/narrative/mocks';
import { createSimstimKit, SCENE_TRI_CAP, zoneTotal } from '../../src/render/simstim/kit';
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

describe('M6.2 Sense/Net content', () => {
  it('authors three gates, Molly lines, and a panic beat', () => {
    const def = senseNetTimeline();
    expect(def.id).toBe('sense-net');
    expect(def.scene).toBe('sensenet');
    expect(def.clockStart).toBe('00:00:00');
    expect(SENSE_NET_GATES.map((g) => g.id)).toEqual(['lobby-door', 'corridor-lock', 'vault-seal']);
    expect(def.lines.length).toBeGreaterThanOrEqual(5);
    expect(def.lines.every((l) => l.who === 'molly' && l.text.split(/\s+/).length <= 3)).toBe(true);
    expect(def.figures.filter((f) => f.rig === 'crowd')).toHaveLength(8);
    expect(SENSE_NET_PANIC_AT).toBe(9);
  });

  it('matches the ?mission=m2 stub gates', () => {
    const m2 = mockM2Mission();
    expect(m2.id).toBe('m2');
    expect(m2.simstim?.timeline).toBe('sense-net');
    expect(m2.simstim?.gates.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`)).toEqual(
      SENSE_NET_GATES.map((g) => `${g.id}:${g.iceNode}:${g.tMeat}`),
    );
  });

  it('keeps each zone under 3k tris', () => {
    const k = kit();
    buildSenseNet(k);
    expect(k.stats.lobby).toBeGreaterThan(80);
    expect(k.stats.corridor).toBeGreaterThan(80);
    expect(k.stats.vault).toBeGreaterThan(40);
    expect(k.stats.lobby).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(k.stats.corridor).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(k.stats.vault).toBeLessThanOrEqual(SCENE_TRI_CAP);
    expect(zoneTotal(k.stats)).toBeLessThanOrEqual(SCENE_TRI_CAP * 3);
    expect(k.figures.has('guard-lobby')).toBe(true);
    expect(k.figures.has('guard-corridor')).toBe(true);
    expect(k.figures.has('guard-vault')).toBe(true);
    expect(k.alarms.length).toBeGreaterThanOrEqual(4);
  });

  it('plays through the timeline and unhides panic crowd on time', () => {
    const tl = createMollyTimeline();
    tl.load(senseNetTimeline());
    const step = SIM_DT;
    for (let t = 0; t < SENSE_NET_PANIC_AT - 0.2; t += step) tl.update(step, t, null);
    const before = tl.sample();
    expect(
      before.figures.filter((f) => f.id.startsWith('crowd-') && f.pose === 'hidden').length,
    ).toBe(8);

    for (let t = SENSE_NET_PANIC_AT - 0.2; t < SENSE_NET_PANIC_AT + 0.3; t += step) {
      tl.update(step, t, null);
    }
    const after = tl.sample();
    expect(after.figures.some((f) => f.id.startsWith('crowd-') && f.pose === 'run')).toBe(true);
    expect(after.clock.startsWith('00:00:')).toBe(true);
    expect(tl.firedLines.length).toBeGreaterThanOrEqual(0);
  });

  it('fires Molly lines once as playback crosses them', () => {
    const tl = createMollyTimeline();
    tl.load(senseNetTimeline());
    const seen: string[] = [];
    for (let i = 0; i < 16 / SIM_DT; i++) {
      tl.update(SIM_DT, (i + 1) * SIM_DT, null);
      for (const line of tl.firedLines) seen.push(line.text);
    }
    expect(seen).toContain("I'm in.");
    expect(seen).toContain('Moderns. Move.');
    expect(seen).toContain('Construct. Going.');
    expect(new Set(seen).size).toBe(seen.length);
  });
});
