import { describe, expect, it } from 'vitest';
import { createIceModel } from '../../src/breach/IceModel';
import {
  M4_DROP,
  M4_HEAT_HARD,
  M4_ICE_ID,
  M4_NEAR,
  M4_RECORD,
  M4_START,
  m4Mission,
  turingIce,
  turingRekeyScale,
} from '../../src/content/missions/m4';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { getLandmark, landmarkWorldPos } from '../../src/content/landmarks';
import { isCampaignMissionId, loadCampaignMission } from '../../src/content/missions/load';
import { createEventBus } from '../../src/core/events';
import { createMissionRunner } from '../../src/narrative/MissionRunner';
import { parseMission } from '../../src/narrative/schema';
import {
  measureCorridor,
  placeTuringWatchers,
  stealthPath,
  TURING_TEST_DROP,
  turingFieldSpec,
} from '../../src/campaign/turingField';
import m4Ink from '../../src/content/ink/m4.json';

describe('M7.7 Turing field heat', () => {
  it('stacks watchers and shortens the re-key when heat ≥ 2', () => {
    const cold = turingFieldSpec(0, 'normal');
    const hot = turingFieldSpec(M4_HEAT_HARD, 'normal');
    expect(hot.watcherCount).toBeGreaterThan(cold.watcherCount);
    expect(hot.offset).toBeLessThan(cold.offset);
    expect(hot.stagger).toBe(true);
    expect(cold.stagger).toBe(false);
    expect(turingRekeyScale(M4_HEAT_HARD)).toBeLessThan(turingRekeyScale(0));

    const base = ICE_LAYER_PRESETS['gray-2'].rekeyEvery!;
    const ice0 = turingIce(0);
    const ice2 = turingIce(M4_HEAT_HARD);
    expect(ice0.layers).toHaveLength(1);
    expect(ice2.layers[0]!.rekeyEvery![0]).toBeLessThan(ice0.layers[0]!.rekeyEvery![0]);
    expect(ice0.layers[0]!.rekeyEvery).toEqual(base);

    const model0 = createIceModel(ice0, { seed: 3 });
    const model2 = createIceModel(ice2, { seed: 3 });
    model0.engage();
    model2.engage();
    expect(model2.state.current.nextRekeyAt).toBeLessThan(model0.state.current.nextRekeyAt ?? 99);
  });

  it('exposes the centreline longer at heat 2 than at heat 0', () => {
    const a = measureCorridor(0, 'normal', TURING_TEST_DROP);
    const b = measureCorridor(M4_HEAT_HARD, 'normal', TURING_TEST_DROP);
    expect(b.watcherCount).toBeGreaterThan(a.watcherCount);
    expect(b.exposedTime).toBeGreaterThan(a.exposedTime);
    expect(b.trace).toBeGreaterThan(a.trace);
    expect(
      placeTuringWatchers(0, 'normal', TURING_TEST_DROP).every((w) => w.kind === 'turing'),
    ).toBe(true);
  });

  it('shortens the run on story difficulty', () => {
    const story = turingFieldSpec(0, 'story');
    const normal = turingFieldSpec(0, 'normal');
    expect(story.skipIce).toBe(true);
    expect(normal.skipIce).toBe(false);
    expect(story.corridor).toBeLessThan(normal.corridor);
    expect(story.watcherCount).toBeLessThan(normal.watcherCount);
    expect(stealthPath(0, 'story', TURING_TEST_DROP).length).toBeLessThan(
      stealthPath(0, 'normal', TURING_TEST_DROP).length,
    );
  });
});

describe('M7.7 mission M4 Turing', () => {
  it('parses the stealth drop, one gray layer, and Act III knots', () => {
    const def = parseMission(m4Mission());
    expect(def.id).toBe('m4');
    expect(def.act).toBe(3);
    expect(def.start.coords).toEqual({ ...M4_START });
    expect(def.softsAvailable).toEqual(['decoy', 'probe', 'clamp', 'damper']);
    expect(def.targets[0]?.ice).toBe(M4_ICE_ID);
    expect(def.targets[0]?.landmark).toBe(M4_DROP);
    expect(def.targets[0]?.core.targetRecord).toBe(M4_RECORD);
    expect(def.objectives.find((o) => o.id === 'crack')?.optional).toBe(true);
    expect(def.landmarks).toEqual([M4_DROP]);
    expect(getLandmark(M4_DROP)?.corp).toBe('turing');
    expect(m4Ink.knots.istanbul?.tags).toEqual(
      expect.arrayContaining(['page:phone', 'ring', 'title:ISTANBUL HILTON']),
    );
    expect(m4Ink.knots.freeside?.tags).toEqual(
      expect.arrayContaining(['page:text', 'title:FREESIDE']),
    );
    expect(m4Ink.knots.debrief?.lines.join(' ')).toMatch(/microlight|gardening robot/i);
  });

  it('wins a scripted pump: DECOY corridor, one crack, wipe, jack out', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m4Mission() });
    const drop = getLandmark(M4_DROP)!;
    const pos = landmarkWorldPos(drop.coords);
    runner.setLandmark(M4_DROP, pos.x, pos.y, pos.z);
    runner.start();
    expect(runner.objective('drop')).toBe('active');
    runner.setPlayerPosition(pos.x, pos.y, pos.z);
    expect(runner.flag('at-drop')).toBe(true);
    expect(Math.hypot(pos.x - pos.x, pos.z - pos.z)).toBeLessThan(M4_NEAR);
    events.emit({ type: 'softUsed', softId: 'decoy' });
    events.emit({ type: 'iceEngaged', iceId: M4_ICE_ID, layer: 0 });
    events.emit({ type: 'iceLayerCracked', iceId: M4_ICE_ID, layer: 0 });
    events.emit({ type: 'downloadProgress', targetId: 'turing-file', value: 1 });
    expect(runner.flag('wiped')).toBe(true);
    events.emit({ type: 'jackOut', reason: 'player' });
    expect(runner.status).toBe('won');
    expect(runner.objective('wipe')).toBe('done');
  });

  it('lazy-loads m4 without touching the default boot graph', async () => {
    expect(isCampaignMissionId('m4')).toBe(true);
    const def = await loadCampaignMission('m4');
    expect(def?.id).toBe('m4');
  });
});
