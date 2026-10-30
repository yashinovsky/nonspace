import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/loop';
import { createEventBus } from '../../src/core/events';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createMissionRunner, type MissionEffects } from '../../src/narrative/MissionRunner';
import { mockTriggerMission } from '../../src/narrative/mocks';
import { MissionValidationError } from '../../src/narrative/schema';
import { createRecordingAudioEngine, recordEvents } from '../../src/testing/mocks';

function harness(effects?: MissionEffects) {
  const events = createEventBus();
  const rec = recordEvents(events);
  const audio = createRecordingAudioEngine();
  const save = createSaveStore({ storage: createMemoryStorage() });
  save.load();
  const runner = createMissionRunner({
    events,
    effects,
    audio: audio.engine,
    save,
    mission: mockTriggerMission(),
  });
  runner.setLandmark('alpha', 100, 0, 0);
  runner.setLandmark('beta', 200, 0, 0);
  return { events, rec, audio, save, runner };
}

function steps(runner: ReturnType<typeof harness>['runner'], seconds: number): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) runner.update(SIM_DT);
}

describe('MissionRunner', () => {
  it('rejects malformed missions with readable paths', () => {
    const { runner } = harness();
    const bad = mockTriggerMission() as unknown as Record<string, unknown>;
    bad.act = 9;
    expect(() => runner.load(bad)).toThrow(MissionValidationError);
    try {
      runner.load(bad);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('mock-triggers');
      expect(message).toContain('act');
    }
  });

  it('runs a scripted mock through time, meatTime, event, near, flags, all/any', () => {
    const log: string[] = [];
    const { events, rec, audio, runner } = harness({
      say: (who, line) => log.push(`say:${who}:${line}`),
      ink: (knot) => log.push(`ink:${knot}`),
      iceMod: (ice, patch) => log.push(`ice:${ice}:${JSON.stringify(patch)}`),
      wintermute: (action) => log.push(`wm:${action.kind}`),
      neuromancer: (action) => log.push(`nm:${action.kind}`),
      forceMode: (mode) => log.push(`mode:${mode}`),
      music: (state) => log.push(`music:${state}`),
      sfx: (id) => log.push(`sfx:${id}`),
    });

    runner.start();
    expect(runner.status).toBe('running');
    expect(runner.checkpointId).toBe('start');
    expect(runner.objective('scan')).toBe('active');
    expect(rec.last('jackIn')?.missionId).toBe('mock-triggers');

    steps(runner, 1);
    expect(runner.flag('t1')).toBe(true);
    expect(log).toContain('say:system:tick.one');
    expect(log).toContain('say:system:flag.t1');

    runner.timeRunning = false;
    steps(runner, 1);
    expect(runner.time).toBeCloseTo(1, 8);
    expect(runner.meatTime).toBeCloseTo(2, 8);
    expect(log).toContain('say:molly:meat.two');
    runner.timeRunning = true;

    events.emit({ type: 'scanPulse', origin: { x: 0, y: 0, z: 0 } });
    expect(runner.flag('scanned')).toBe(true);
    expect(runner.objective('scan')).toBe('done');
    expect(runner.objective('arrive')).toBe('active');
    expect(log).toContain('sfx:scan');
    expect(audio.callsTo('sfx')).toEqual([{ method: 'sfx', args: ['scan'] }]);

    runner.setPlayerPosition(100, 0, 0);
    expect(runner.flag('arrived')).toBe(true);
    expect(runner.flag('ready')).toBe(true);
    expect(runner.objective('arrive')).toBe('done');
    expect(runner.objective('combo')).toBe('active');
    expect(runner.checkpointId).toBe('mid');
    expect(log).toContain('music:approach');
    expect(log).toContain('ink:mock-ready');
    expect(audio.callsTo('music.setState')).toEqual([
      { method: 'music.setState', args: ['approach'] },
    ]);

    events.emit({ type: 'downloadProgress', targetId: 'core-1', value: 1 });
    runner.setPlayerPosition(200, 0, 0);
    expect(runner.objective('combo')).toBe('done');
    expect(runner.status).toBe('won');

    events.emit({ type: 'iceLayerCracked', iceId: 'test-white', layer: 0 });
    events.flush();
    expect(runner.icePatch('test-white')).toEqual({ rekeyEvery: [3, 5] });
    expect(log).toContain('wm:freeze');
    expect(log).toContain('nm:soften');
    expect(log).toContain('mode:breach');
    expect(rec.last('wintermute')?.action).toEqual({ kind: 'freeze', on: true });
    expect(rec.ofType('objective').map((e) => `${e.id}:${e.state}`)).toEqual([
      'scan:active',
      'scan:done',
      'arrive:active',
      'arrive:done',
      'combo:active',
      'combo:done',
    ]);
  });

  it('fails on a matching flatline and does not re-fire timeline rows', () => {
    const { events, runner } = harness();
    runner.start();
    steps(runner, 1);
    expect(runner.flag('t1')).toBe(true);
    steps(runner, 1);
    events.emit({ type: 'flatline', scripted: false });
    expect(runner.status).toBe('failed');
    expect(runner.failed).toBe(true);
    expect(runner.objective('scan')).toBe('failed');
    expect(runner.objective('arrive')).toBe('inactive');
    expect(runner.objective('combo')).toBe('inactive');

    steps(runner, 5);
    expect(runner.flag('t1')).toBe(true);
  });

  it('ignores a scripted flatline that does not match `where`', () => {
    const { events, runner } = harness();
    runner.start();
    events.emit({ type: 'flatline', scripted: true });
    expect(runner.status).toBe('running');
    expect(runner.failed).toBe(false);
  });

  it('checkpoint restore reproduces clocks, flags, objectives, latches and ice', () => {
    const { events, runner } = harness();
    runner.start();
    steps(runner, 1);
    events.emit({ type: 'scanPulse', origin: { x: 1, y: 0, z: 0 } });
    runner.setPlayerPosition(100, 0, 0);
    const mid = runner.checkpointSnapshot('mid');
    expect(mid).toBeDefined();
    expect(runner.checkpointId).toBe('mid');

    events.emit({ type: 'iceLayerCracked', iceId: 'test-white', layer: 1 });
    const afterIce = runner.snapshot();
    expect(afterIce.icePatches).toEqual([{ ice: 'test-white', patch: { rekeyEvery: [3, 5] } }]);
    const serialized = runner.serialize();

    runner.update(10);
    events.emit({ type: 'flatline', scripted: false });
    expect(runner.status).toBe('failed');
    expect(runner.time).toBeGreaterThan(mid!.time);

    runner.restoreCheckpoint('mid');
    expect(runner.status).toBe('running');
    expect(runner.time).toBeCloseTo(mid!.time, 10);
    expect(runner.meatTime).toBeCloseTo(mid!.meatTime, 10);
    expect(runner.flag('ready')).toBe(true);
    expect(runner.flag('scanned')).toBe(true);
    expect(runner.flag('t1')).toBe(true);
    expect(runner.objective('scan')).toBe('done');
    expect(runner.objective('arrive')).toBe('done');
    expect(runner.objective('combo')).toBe('active');
    expect(runner.icePatch('test-white')).toBeUndefined();
    expect(runner.checkpointId).toBe('mid');
    expect(runner.failed).toBe(false);

    runner.deserialize(serialized);
    expect(runner.snapshot()).toEqual(afterIce);
    expect(runner.icePatch('test-white')).toEqual({ rekeyEvery: [3, 5] });

    events.emit({ type: 'downloadProgress', targetId: 'core-1', value: 1 });
    runner.setPlayerPosition(200, 0, 0);
    expect(runner.objective('combo')).toBe('done');
    expect(runner.status).toBe('won');
  });

  it('start({ checkpoint }) seeks mid on a fresh run and writes the save', () => {
    const { runner, save } = harness();
    runner.start({ checkpoint: 'mid' });
    expect(runner.checkpointId).toBe('mid');
    expect(runner.flag('ready')).toBe(true);
    expect(save.data.campaign.missionId).toBe('mock-triggers');
    expect(save.data.campaign.checkpoint).toBe('mid');
    expect(save.data.campaign.flags.ready).toBe(true);
  });
});
