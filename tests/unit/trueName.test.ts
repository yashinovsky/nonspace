import { describe, expect, it } from 'vitest';
import { createIceModel } from '../../src/breach/IceModel';
import { getLandmark, landmarkWorldPos } from '../../src/content/landmarks';
import { isCampaignMissionId, loadCampaignMission } from '../../src/content/missions/load';
import {
  M7_CLUSTER,
  M7_ICE_ID,
  M7_NEAR,
  M7_START,
  M7_WORD,
  M7_WORD_SPOKEN_AT,
  M7_WORD_WINDOW_S,
  m7Mission,
  normalizeWord,
  trueNameIce,
  wordMatches,
} from '../../src/content/missions/m7';
import { STRAYLIGHT_M7_GATES, STRAYLIGHT_WORD } from '../../src/content/simstim/straylight';
import { MERGE_DURATION, mergePhaseAt, mergeSample } from '../../src/campaign/merge';
import { createEventBus } from '../../src/core/events';
import { createMissionRunner } from '../../src/narrative/MissionRunner';
import { parseMission } from '../../src/narrative/schema';
import m7Ink from '../../src/content/ink/m7.json';

describe('M7.11 mission M7 True Name', () => {
  it('parses word climax, merge, erase, and Act V knots', () => {
    const def = parseMission(m7Mission());
    expect(def.id).toBe('m7');
    expect(def.act).toBe(5);
    expect(def.start.coords).toEqual({ ...M7_START });
    expect(def.landmarks).toEqual([M7_CLUSTER]);
    expect(def.targets[0]?.ice).toBe(M7_ICE_ID);
    expect(def.simstim?.timeline).toBe('straylight-m7');
    expect(def.simstim?.gates.map((g) => g.id)).toEqual(STRAYLIGHT_M7_GATES.map((g) => g.id));
    expect(def.simstim?.gates.find((g) => g.id === 'word-window')?.late).toBe(M7_WORD_WINDOW_S);
    expect(def.checkpoints.map((c) => c.id)).toEqual([
      'core',
      'word',
      'merge',
      'erase',
      'epilogue',
    ]);
    expect(def.fail[0]).toEqual({
      t: 'event',
      type: 'gateWindow',
      where: { gateId: 'word-window', state: 'missed' },
    });
    expect(M7_WORD).toBe(STRAYLIGHT_WORD);
    expect(wordMatches(' To  Whom ')).toBe(true);
    expect(wordMatches('neuromancer')).toBe(false);
    expect(normalizeWord('To  WHOM')).toBe('to whom');
    expect(trueNameIce().hue).toBeDefined();
    expect(createIceModel(trueNameIce(), { seed: 23 }).def.id).toBe(M7_ICE_ID);
    expect(m7Ink.knots.brief?.tags).toEqual(
      expect.arrayContaining(['page:text', 'title:TRUE NAME']),
    );
    expect(m7Ink.knots.erased?.name).toBe('erased');
    expect(m7Ink.knots.kept?.name).toBe('kept');
    expect(m7Ink.knots.credits?.lines.join(' ')).toMatch(/Hershey/i);
    expect(m7Ink.knots.credits?.lines.join(' ')).toMatch(/Px437/i);
  });

  it('wins a scripted pump: watch, type, merge, erase, ending A', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m7Mission() });
    const cluster = getLandmark(M7_CLUSTER)!;
    const pos = landmarkWorldPos(cluster.coords);
    runner.setLandmark(M7_CLUSTER, pos.x, pos.y, pos.z);
    runner.start();
    events.emit({ type: 'jackIn', missionId: 'm7' });
    expect(runner.checkpointId).toBe('core');
    runner.setPlayerPosition(pos.x, pos.y, pos.z);
    expect(runner.flag('at-core')).toBe(true);
    expect(M7_NEAR).toBeGreaterThan(100);
    runner.meatTimeRunning = true;
    runner.update(M7_WORD_SPOKEN_AT);
    expect(runner.flag('word-ready')).toBe(true);
    expect(runner.checkpointId).toBe('word');
    events.emit({ type: 'iceLayerCracked', iceId: 'straylight-head', layer: 0 });
    events.emit({ type: 'iceLayerCracked', iceId: 'straylight-word', layer: 0 });
    expect(runner.flag('word-in')).toBe(true);
    events.emit({ type: 'downloadProgress', targetId: 'merge', value: 1 });
    expect(runner.flag('merged')).toBe(true);
    events.emit({ type: 'downloadProgress', targetId: 'erase', value: 1 });
    expect(runner.flag('erased-answered')).toBe(true);
    events.emit({ type: 'downloadProgress', targetId: 'ending-a', value: 1 });
    expect(runner.flag('ending-a')).toBe(true);
    expect(runner.status).toBe('won');
    expect(runner.objective('ending')).toBe('done');
  });

  it('fails when the word window is missed, then a fresh runner can retry', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m7Mission() });
    const cluster = getLandmark(M7_CLUSTER)!;
    const pos = landmarkWorldPos(cluster.coords);
    runner.setLandmark(M7_CLUSTER, pos.x, pos.y, pos.z);
    runner.start();
    events.emit({ type: 'jackIn', missionId: 'm7' });
    runner.setPlayerPosition(pos.x, pos.y, pos.z);
    runner.meatTimeRunning = true;
    runner.update(M7_WORD_SPOKEN_AT);
    expect(runner.checkpointId).toBe('word');
    events.emit({ type: 'gateWindow', gateId: 'word-window', state: 'missed' });
    expect(runner.status).toBe('failed');
    const snap = runner.checkpointSnapshot('word');
    expect(snap).toBeTruthy();
    runner.restoreCheckpoint('word');
    expect(runner.status).toBe('running');
    expect(runner.flag('word-ready')).toBe(true);
    expect(runner.flag('word-in')).toBe(false);
  });

  it('lazy-loads m7 without touching the default boot graph', async () => {
    expect(isCampaignMissionId('m7')).toBe(true);
    const def = await loadCampaignMission('m7');
    expect(def?.id).toBe('m7');
  });
});

describe('M7.11 merge sequence', () => {
  it('breaks the palette, folds, reflows, then unifies over five minutes', () => {
    expect(MERGE_DURATION).toBe(300);
    expect(mergePhaseAt(0)).toBe('break');
    expect(mergePhaseAt(80)).toBe('fold');
    expect(mergePhaseAt(150)).toBe('reflow');
    expect(mergePhaseAt(250)).toBe('unify');
    expect(mergePhaseAt(300)).toBe('done');
    const mid = mergeSample(220);
    expect(mid.fold).toBeGreaterThan(0.9);
    expect(mid.personaMix).toBeGreaterThan(0.2);
    expect(mid.warp).toHaveLength(4);
    const calm = mergeSample(40, true);
    const flash = mergeSample(40, false);
    expect(calm.lerpWhite).toBeLessThan(flash.lerpWhite);
  });
});
