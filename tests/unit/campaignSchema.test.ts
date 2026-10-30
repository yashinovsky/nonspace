import { describe, expect, it } from 'vitest';
import { LANDMARK_IDS } from '../../src/content/landmarks';
import {
  CAMPAIGN_MISSION_IDS,
  isCampaignMissionId,
  loadCampaignMission,
} from '../../src/content/missions/load';
import { getSoft } from '../../src/content/softs';
import type { Action, MissionDef } from '../../src/narrative/schema';
import { parseMission } from '../../src/narrative/schema';
import m1Ink from '../../src/content/ink/m1.json';
import m2Ink from '../../src/content/ink/m2.json';
import m3Ink from '../../src/content/ink/m3.json';
import m4Ink from '../../src/content/ink/m4.json';
import m5Ink from '../../src/content/ink/m5.json';
import m6Ink from '../../src/content/ink/m6.json';
import m7Ink from '../../src/content/ink/m7.json';
import p0Ink from '../../src/content/ink/p0.json';

const INK: Record<string, { knots: Record<string, unknown> }> = {
  p0: p0Ink,
  m1: m1Ink,
  m2: m2Ink,
  m3: m3Ink,
  m4: m4Ink,
  m5: m5Ink,
  m6: m6Ink,
  m7: m7Ink,
};

function allActions(def: MissionDef): Action[] {
  const out: Action[] = [];
  for (const row of def.timeline) out.push(...row.do);
  for (const gate of def.simstim?.gates ?? []) {
    out.push(...gate.onEarly, ...gate.onLate);
  }
  return out;
}

describe('campaign mission schema (p0, m1–m7)', () => {
  it('lists every campaign id exactly once', () => {
    expect(CAMPAIGN_MISSION_IDS).toEqual(['p0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    expect(new Set(CAMPAIGN_MISSION_IDS).size).toBe(CAMPAIGN_MISSION_IDS.length);
    expect(isCampaignMissionId('m8')).toBe(false);
    expect(isCampaignMissionId(null)).toBe(false);
  });

  it('zod-validates every campaign mission and its ink / landmarks / softs', async () => {
    const expectedAct: Record<(typeof CAMPAIGN_MISSION_IDS)[number], number> = {
      p0: 1,
      m1: 1,
      m2: 2,
      m3: 2,
      m4: 3,
      m5: 4,
      m6: 4,
      m7: 5,
    };

    for (const id of CAMPAIGN_MISSION_IDS) {
      const raw = await loadCampaignMission(id);
      expect(raw, id).toBeTruthy();
      const def = parseMission(raw);
      expect(def).toEqual(raw);
      expect(def.id).toBe(id);
      expect(def.act).toBe(expectedAct[id]);

      const objIds = def.objectives.map((o) => o.id);
      expect(new Set(objIds).size, `${id} objectives`).toBe(objIds.length);
      const cpIds = def.checkpoints.map((c) => c.id);
      expect(new Set(cpIds).size, `${id} checkpoints`).toBe(cpIds.length);

      for (const landmark of def.landmarks) {
        expect(LANDMARK_IDS, `${id} landmark ${landmark}`).toContain(landmark);
      }
      for (const target of def.targets) {
        expect(LANDMARK_IDS, `${id} target ${target.id}`).toContain(target.landmark);
        expect(target.ice.length).toBeGreaterThan(0);
      }
      for (const soft of def.softsAvailable) {
        expect(getSoft(soft), `${id} soft ${soft}`).toBeTruthy();
      }

      const inkFiles = [def.briefing.ink, def.debrief.ink];
      for (const inkId of inkFiles) {
        expect(INK[inkId], `${id} ink ${inkId}`).toBeTruthy();
      }
      expect(INK[def.briefing.ink]?.knots[def.briefing.knot], `${id} briefing knot`).toBeTruthy();
      expect(INK[def.debrief.ink]?.knots[def.debrief.knot], `${id} debrief knot`).toBeTruthy();

      for (const action of allActions(def)) {
        if (action.a !== 'ink') continue;
        const briefingHas = INK[def.briefing.ink]?.knots[action.knot];
        const debriefHas = INK[def.debrief.ink]?.knots[action.knot];
        expect(briefingHas || debriefHas, `${id} ink knot ${action.knot}`).toBeTruthy();
      }
    }
  });

  it('rejects a typo in authored campaign JSON', async () => {
    const m1 = await loadCampaignMission('m1');
    expect(m1).toBeTruthy();
    const bad = structuredClone(m1) as unknown as Record<string, unknown>;
    bad.act = 9;
    expect(() => parseMission(bad)).toThrow(/m1/);
  });
});
