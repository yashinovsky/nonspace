import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/core/events';
import {
  compileMission,
  compileTrigger,
  evalTrigger,
  eventMatches,
  latchEvent,
  type TriggerWorld,
} from '../../src/narrative/triggers';
import { mockTriggerMission } from '../../src/narrative/mocks';
import type { Trigger } from '../../src/narrative/schema';

function world(partial: Partial<TriggerWorld> = {}): TriggerWorld {
  return {
    time: 0,
    meatTime: 0,
    flags: {},
    hasPos: false,
    posX: 0,
    posY: 0,
    posZ: 0,
    landmarks: new Map(),
    ...partial,
  };
}

describe('trigger interpreter', () => {
  it('matches event `where` as a shallow subset', () => {
    const cracked: GameEvent = { type: 'iceLayerCracked', iceId: 'test-white', layer: 0 };
    expect(eventMatches(cracked, 'iceLayerCracked', [['iceId', 'test-white']])).toBe(true);
    expect(eventMatches(cracked, 'iceLayerCracked', [['iceId', 'other']])).toBe(false);
    expect(eventMatches(cracked, 'iceRekey', [['iceId', 'test-white']])).toBe(false);
    expect(eventMatches(cracked, 'iceLayerCracked')).toBe(true);
  });

  it('evaluates time, meatTime, flag, near, all, any', () => {
    const nodes: Parameters<typeof compileTrigger>[1] = [];
    const eventNodes: number[] = [];
    const latched = new Uint8Array(32);
    const add = (t: Trigger): number => compileTrigger(t, nodes, eventNodes);

    const time = add({ t: 'time', s: 1 });
    const meat = add({ t: 'meatTime', s: 2 });
    const flag = add({ t: 'flag', name: 'ready' });
    const near = add({ t: 'near', landmark: 'alpha', radius: 10 });
    const all = add({
      t: 'all',
      of: [
        { t: 'flag', name: 'ready' },
        { t: 'near', landmark: 'alpha', radius: 10 },
      ],
    });
    const any = add({
      t: 'any',
      of: [
        { t: 'flag', name: 'ready' },
        { t: 'time', s: 99 },
      ],
    });

    const w = world({
      time: 1,
      meatTime: 1.5,
      flags: { ready: true },
      hasPos: true,
      posX: 3,
      landmarks: new Map([['alpha', { x: 0, y: 0, z: 0 }]]),
    });

    expect(evalTrigger(nodes, time, w, latched)).toBe(true);
    expect(evalTrigger(nodes, meat, w, latched)).toBe(false);
    w.meatTime = 2;
    expect(evalTrigger(nodes, meat, w, latched)).toBe(true);
    expect(evalTrigger(nodes, flag, w, latched)).toBe(true);
    expect(evalTrigger(nodes, near, w, latched)).toBe(true);
    expect(evalTrigger(nodes, all, w, latched)).toBe(true);
    expect(evalTrigger(nodes, any, w, latched)).toBe(true);

    w.flags.ready = false;
    expect(evalTrigger(nodes, all, w, latched)).toBe(false);
    expect(evalTrigger(nodes, any, w, latched)).toBe(false);
  });

  it('latches event nodes so they stay true after the event', () => {
    const nodes: Parameters<typeof compileTrigger>[1] = [];
    const eventNodes: number[] = [];
    const root = compileTrigger(
      { t: 'event', type: 'scanPulse', where: undefined },
      nodes,
      eventNodes,
    );
    const latched = new Uint8Array(nodes.length);
    const w = world();
    expect(evalTrigger(nodes, root, w, latched)).toBe(false);
    expect(
      latchEvent(nodes, eventNodes, { type: 'scanPulse', origin: { x: 1, y: 2, z: 3 } }, latched),
    ).toBe(true);
    expect(evalTrigger(nodes, root, w, latched)).toBe(true);
    expect(
      latchEvent(nodes, eventNodes, { type: 'scanPulse', origin: { x: 0, y: 0, z: 0 } }, latched),
    ).toBe(false);
  });

  it('compiles the mock mission without allocating extra event roots', () => {
    const compiled = compileMission(mockTriggerMission());
    expect(compiled.eventNodes.length).toBeGreaterThan(0);
    expect(compiled.objectiveWhen).toHaveLength(3);
    expect(compiled.timelineAt.length).toBe(mockTriggerMission().timeline.length);
  });
});
