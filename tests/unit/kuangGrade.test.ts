import { describe, expect, it } from 'vitest';
import { createIceModel } from '../../src/breach/IceModel';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { getLandmark, landmarkWorldPos } from '../../src/content/landmarks';
import { isCampaignMissionId, loadCampaignMission } from '../../src/content/missions/load';
import {
  M5_CLUSTER,
  M5_HIJACK,
  M5_ICE_ID,
  M5_NEAR,
  M5_START,
  m5Mission,
  straylightIce,
} from '../../src/content/missions/m5';
import { STRAYLIGHT_M5_GATES } from '../../src/content/simstim/straylight';
import { createEventBus } from '../../src/core/events';
import { createMissionRunner } from '../../src/narrative/MissionRunner';
import { parseMission } from '../../src/narrative/schema';
import { KUANG_GATE_TOL } from '../../src/world/diveMath';
import m5Ink from '../../src/content/ink/m5.json';

describe('M7.9 mission M5 Kuang Grade Mark Eleven', () => {
  it('parses phases A–E, Straylight gates, and Kuang-generous ICE', () => {
    const def = parseMission(m5Mission());
    expect(def.id).toBe('m5');
    expect(def.act).toBe(4);
    expect(def.start.coords).toEqual({ ...M5_START });
    expect(def.landmarks).toEqual([M5_CLUSTER]);
    expect(def.targets[0]?.ice).toBe(M5_ICE_ID);
    expect(def.softsAvailable).toContain('kuang');
    expect(def.checkpoints.map((c) => c.id)).toEqual([
      'ascent',
      'deploy',
      'dive',
      'straylight',
      'intercept',
    ]);
    expect(def.simstim?.timeline).toBe('straylight-m5');
    expect(def.simstim?.gates.map((g) => g.id)).toEqual(STRAYLIGHT_M5_GATES.map((g) => g.id));
    expect(getLandmark(M5_CLUSTER)?.corp).toBe('tessierAshpool');
    expect(straylightIce().hue).toBeDefined();
    expect(ICE_LAYER_PRESETS['kuang-gate'].tolRatio).toBe(KUANG_GATE_TOL);
    expect(KUANG_GATE_TOL).toBeGreaterThan(ICE_LAYER_PRESETS['gray-2'].tolRatio);
    const ice = createIceModel(straylightIce(), { seed: 11 });
    ice.engage();
    expect(ice.def.layers[0]!.tolRatio).toBeGreaterThan(ICE_LAYER_PRESETS['gray-2'].tolRatio);
    expect(m5Ink.knots.brief?.tags).toEqual(
      expect.arrayContaining(['page:text', 'title:KUANG GRADE MARK ELEVEN']),
    );
    expect(m5Ink.knots.debrief?.tags).toEqual(
      expect.arrayContaining(['page:text', 'title:THE BEACH']),
    );
    expect(M5_HIJACK).toBe('COUNTING.');
  });

  it('wins a scripted pump: ascent, deploy, dive gates + Molly, intercept', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m5Mission() });
    const cluster = getLandmark(M5_CLUSTER)!;
    const pos = landmarkWorldPos(cluster.coords);
    runner.setLandmark(M5_CLUSTER, pos.x, pos.y, pos.z);
    runner.start();
    events.emit({ type: 'jackIn', missionId: 'm5' });
    expect(runner.checkpointId).toBe('ascent');
    runner.setPlayerPosition(pos.x, pos.y, pos.z);
    expect(runner.flag('at-cluster')).toBe(true);
    expect(M5_NEAR).toBeGreaterThan(100);
    events.emit({ type: 'softUsed', softId: 'kuang' });
    expect(runner.flag('kuang-out')).toBe(true);
    events.emit({ type: 'modeChanged', from: 'matrix', to: 'dive' });
    expect(runner.flag('diving')).toBe(true);
    events.emit({ type: 'iceLayerCracked', iceId: 'straylight-hall', layer: 0 });
    events.emit({ type: 'iceLayerCracked', iceId: 'straylight-stair', layer: 0 });
    events.emit({ type: 'iceLayerCracked', iceId: 'straylight-gallery', layer: 0 });
    expect(runner.flag('molly-in')).toBe(true);
    expect(runner.checkpointId).toBe('straylight');
    events.emit({ type: 'flatline', scripted: true });
    expect(runner.flag('intercepted')).toBe(true);
    expect(runner.status).toBe('won');
    expect(runner.objective('intercept')).toBe('done');
  });

  it('lazy-loads m5 without touching the default boot graph', async () => {
    expect(isCampaignMissionId('m5')).toBe(true);
    const def = await loadCampaignMission('m5');
    expect(def?.id).toBe('m5');
  });
});
