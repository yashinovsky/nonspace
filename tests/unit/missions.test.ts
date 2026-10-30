import { describe, expect, it } from 'vitest';
import { TUTORIAL_LABELS } from '../../src/campaign/tutorialPrompts';
import { CHIBA_CLUSTER_IDS, getLandmark } from '../../src/content/landmarks';
import { createIceModel } from '../../src/breach/IceModel';
import { isCampaignMissionId, loadCampaignMission } from '../../src/content/missions/load';
import { m1Mission, M1_ICE_ID, M1_LOOK_S, M1_START } from '../../src/content/missions/m1';
import {
  applySenseNetRekey,
  m2Mission,
  M2_ICE_ID,
  M2_REKEY,
  M2_REKEY_PANIC,
  M2_START,
  senseNetIce,
} from '../../src/content/missions/m2';
import { p0Mission } from '../../src/content/missions/p0';
import { SENSE_NET_CAMPAIGN_PANIC_AT } from '../../src/content/simstim/senseNet';
import { parseMission } from '../../src/narrative/schema';

describe('M7.4 campaign missions', () => {
  it('parses P0 Night City', () => {
    const def = parseMission(p0Mission());
    expect(def.id).toBe('p0');
    expect(def.act).toBe(1);
    expect(def.softsAvailable).toEqual([]);
    expect(def.landmarks).toEqual(['chatsubo', 'cheap-hotel', 'ninsei', 'chiba-node']);
    expect(def.objectives).toHaveLength(1);
    expect(def.timeline[0]?.do.some((a) => a.a === 'say' && a.who === 'system')).toBe(true);
    expect(def.timeline[0]?.do.some((a) => a.a === 'say' && a.who === 'dixie')).toBe(false);
  });

  it('parses M1 Distanceless Home', () => {
    const def = parseMission(m1Mission());
    expect(def.id).toBe('m1');
    expect(def.start.coords).toEqual({ ...M1_START });
    expect(def.softsAvailable).toEqual(['probe', 'clamp']);
    expect(def.targets[0]?.ice).toBe(M1_ICE_ID);
    expect(def.targets[0]?.landmark).toBe('chiba-node');
    expect(def.objectives.some((o) => o.id === 'look' && o.optional)).toBe(true);
    expect(def.checkpoints.map((c) => c.id)).toEqual(['start', 'look', 'chiba', 'core', 'take']);
    expect(def.timeline.some((row) => row.at.t === 'time' && row.at.s === M1_LOOK_S)).toBe(true);
    for (const row of def.timeline) {
      for (const a of row.do) {
        if (a.a === 'say') expect(a.who).not.toBe('dixie');
      }
    }
  });

  it('parses M2 Sense/Net', () => {
    const def = parseMission(m2Mission());
    expect(def.id).toBe('m2');
    expect(def.act).toBe(2);
    expect(def.start.coords).toEqual({ ...M2_START });
    expect(def.targets[0]?.ice).toBe(M2_ICE_ID);
    expect(def.simstim?.gates).toHaveLength(3);
    expect(def.simstim?.gates.map((g) => g.tMeat)).toEqual([80, 200, 280]);
    expect(def.fail.length).toBeGreaterThanOrEqual(2);
    expect(def.checkpoints.map((c) => c.id)).toEqual([
      'start',
      'approach',
      'lobby',
      'panic',
      'vault',
    ]);
    expect(
      def.timeline.some(
        (row) => row.at.t === 'meatTime' && row.at.s === SENSE_NET_CAMPAIGN_PANIC_AT,
      ),
    ).toBe(true);
    for (const row of def.timeline) {
      for (const a of row.do) {
        if (a.a === 'say') expect(a.who).not.toBe('dixie');
      }
    }
  });

  it('lazy-loads campaign missions by id', async () => {
    expect(isCampaignMissionId('p0')).toBe(true);
    expect(isCampaignMissionId('m1')).toBe(true);
    expect(isCampaignMissionId('m2')).toBe(true);
    const p0 = await loadCampaignMission('p0');
    const m1 = await loadCampaignMission('m1');
    const m2 = await loadCampaignMission('m2');
    expect(p0?.id).toBe('p0');
    expect(m1?.id).toBe('m1');
    expect(m2?.id).toBe('m2');
    expect(await loadCampaignMission('nope')).toBeNull();
  });

  it('halves Sense/Net re-key rate during the Moderns panic', () => {
    const ice = createIceModel(senseNetIce(), { seed: 4 });
    ice.engage();
    expect(ice.def.layers[0]?.rekeyEvery).toEqual(M2_REKEY.lobby);
    const before = ice.state.current.nextRekeyAt;
    expect(before).not.toBeNull();
    applySenseNetRekey(ice, true);
    expect(ice.def.layers[0]?.rekeyEvery).toEqual(M2_REKEY_PANIC.lobby);
    expect(ice.def.layers[2]?.rekeyEvery).toEqual(M2_REKEY_PANIC.vault);
    expect(ice.state.current.nextRekeyAt).toBeGreaterThan(before ?? 0);
    applySenseNetRekey(ice, false);
    expect(ice.def.layers[0]?.rekeyEvery).toEqual(M2_REKEY.lobby);
  });
});

describe('M7.4 Chiba cluster and tutorial labels', () => {
  it('authors the Chiba cluster landmarks', () => {
    expect([...CHIBA_CLUSTER_IDS]).toEqual([
      'chiba-node',
      'hosaka',
      'ninsei',
      'chatsubo',
      'cheap-hotel',
    ]);
    for (const id of CHIBA_CLUSTER_IDS) {
      const def = getLandmark(id);
      expect(def).toBeTruthy();
      expect(def?.coords.region).toBe('CHBA');
    }
    expect(getLandmark('ninsei')?.parts[0]?.spec.kind).toBe('geodesic');
    expect(getLandmark('chatsubo')?.parts[0]?.spec.kind).toBe('box');
    expect(getLandmark('cheap-hotel')?.parts[0]?.spec.kind).toBe('cubeStack');
  });

  it('keeps diegetic Hershey labels Dixie-less', () => {
    const texts = TUTORIAL_LABELS.map((l) => l.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'SCAN (F)',
        'PUNCH (TAB)',
        'ENGAGE (LMB)',
        'RATIO',
        'PHASE',
        'HOLD LOCK',
        'HOLD E',
      ]),
    );
    expect(texts.join(' ')).not.toMatch(/dixie/i);
  });
});
