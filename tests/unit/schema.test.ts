import { describe, expect, it } from 'vitest';
import {
  actionSchema,
  MissionValidationError,
  parseMission,
  triggerSchema,
} from '../../src/narrative/schema';
import { sampleMission } from '../../src/testing/fixtures';

describe('mission schema', () => {
  it('accepts the sample mission', () => {
    const mission = sampleMission();
    expect(parseMission(mission)).toEqual(mission);
  });

  it('accepts nested all/any triggers', () => {
    const t = {
      t: 'any',
      of: [
        { t: 'meatTime', s: 30 },
        {
          t: 'all',
          of: [
            { t: 'flag', name: 'a' },
            { t: 'time', s: 5 },
          ],
        },
      ],
    };
    expect(triggerSchema.parse(t)).toEqual(t);
  });

  it('accepts iceMod patches and AI actions', () => {
    expect(
      actionSchema.parse({ a: 'iceMod', ice: 'gray-2', patch: { rekeyEvery: [3, 5] } }),
    ).toBeTruthy();
    expect(
      actionSchema.parse({ a: 'wintermute', action: { kind: 'freeze', on: true } }),
    ).toBeTruthy();
    expect(
      actionSchema.parse({ a: 'neuromancer', action: { kind: 'soften', amount: 0.5 } }),
    ).toBeTruthy();
    expect(actionSchema.parse({ a: 'forceMode', mode: 'beach' })).toBeTruthy();
  });

  it('rejects unknown event types in triggers', () => {
    expect(() => triggerSchema.parse({ t: 'event', type: 'notAnEvent' })).toThrow();
  });

  it('rejects unknown keys (typos) in content', () => {
    expect(() => triggerSchema.parse({ t: 'time', s: 1, sec: 2 })).toThrow();
    expect(() =>
      actionSchema.parse({ a: 'iceMod', ice: 'x', patch: { tolRatioo: 0.1 } }),
    ).toThrow();
  });

  it('reports readable paths for malformed missions', () => {
    const bad = sampleMission() as unknown as Record<string, unknown>;
    bad.act = 9;
    (bad.objectives as Array<Record<string, unknown>>)[1]!.when = { t: 'flag' };

    let caught: unknown;
    try {
      parseMission(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissionValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('test-mission');
    expect(message).toContain('act');
    expect(message).toContain('objectives[1].when');
  });
});
