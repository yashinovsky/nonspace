import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/render/beach/world';
import { isCampaignMissionId, loadCampaignMission } from '../../src/content/missions/load';
import { M6_BASS, M6_HEAR_RADIUS, M6_START, m6Mission } from '../../src/content/missions/m6';
import { createEventBus } from '../../src/core/events';
import { createMissionRunner } from '../../src/narrative/MissionRunner';
import { parseMission } from '../../src/narrative/schema';
import m6Ink from '../../src/content/ink/m6.json';

describe('M7.10 mission M6 The Beach', () => {
  it('parses walking-only construct with stay/leave choice', () => {
    const def = parseMission(m6Mission());
    expect(def.id).toBe('m6');
    expect(def.act).toBe(4);
    expect(def.start.coords).toEqual({ ...M6_START });
    expect(def.softsAvailable).toEqual([]);
    expect(def.targets).toEqual([]);
    expect(def.objectives.map((o) => o.id)).toEqual(['wake', 'hear', 'leave', 'stay', 'choose']);
    expect(def.objectives.find((o) => o.id === 'hear')?.optional).toBe(true);
    expect(def.objectives.find((o) => o.id === 'leave')?.optional).toBe(true);
    expect(def.objectives.find((o) => o.id === 'stay')?.optional).toBe(true);
    expect(def.objectives.find((o) => o.id === 'choose')?.optional).toBeUndefined();
  });

  it('wins a scripted pump: walk-out (leave) or stay (Ending B)', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m6Mission() });
    runner.setLandmark(M6_BASS, EXIT.x, 0, EXIT.z);
    runner.start();
    expect(runner.flag('on-beach')).toBe(true);
    expect(runner.objective('wake')).toBe('done');
    runner.setPlayerPosition(EXIT.x, 0, EXIT.z);
    expect(Math.hypot(EXIT.x - EXIT.x, EXIT.z - EXIT.z)).toBeLessThan(M6_HEAR_RADIUS);
    expect(runner.objective('hear')).toBe('done');
    events.emit({ type: 'beachChoice', choice: 'leave' });
    expect(runner.flag('beachLeft')).toBe(true);
    expect(runner.status).toBe('won');
    expect(runner.objective('choose')).toBe('done');
    expect(runner.objective('leave')).toBe('done');
  });

  it('stay path sets Ending B and still wins', () => {
    const events = createEventBus();
    const runner = createMissionRunner({ events, mission: m6Mission() });
    runner.start();
    events.emit({ type: 'beachChoice', choice: 'stay' });
    expect(runner.flag('endingB')).toBe(true);
    expect(runner.status).toBe('won');
    expect(runner.objective('stay')).toBe('done');
    expect(runner.objective('choose')).toBe('done');
  });

  it('lazy-loads m6 without touching the default boot graph', async () => {
    expect(isCampaignMissionId('m6')).toBe(true);
    const def = await loadCampaignMission('m6');
    expect(def?.id).toBe('m6');
    expect(m6Ink.knots.brief?.tags).toEqual(
      expect.arrayContaining(['page:text', 'title:THE BEACH']),
    );
    expect(m6Ink.knots.debrief?.lines.join(' ')).toMatch(/bassline|sunset/i);
  });
});
