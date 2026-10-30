import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryStorage,
  createSaveStore,
  defaultCampaign,
  MIGRATIONS,
  parseSave,
  SAVE_KEY,
  SAVE_VERSION,
  type Migration,
} from '../../src/core/save';
import { createSettingsStore, defaultSettings } from '../../src/core/settings';

describe('save', () => {
  it('starts from defaults when nothing is stored', () => {
    const store = createSaveStore({ storage: createMemoryStorage() });
    expect(store.load()).toBe('new');
    expect(store.data.campaign).toEqual(defaultCampaign());
    expect(store.data.settings).toEqual(defaultSettings());
    expect(store.data.version).toBe(SAVE_VERSION);
  });

  it('round-trips campaign and settings through storage', () => {
    const storage = createMemoryStorage();
    const a = createSaveStore({ storage });
    a.load();
    a.data.campaign = {
      ...a.data.campaign,
      act: 3,
      missionId: 'm4',
      checkpoint: 'gate2',
      heat: 42.5,
      scars: 2,
      flatlines: 7,
      softsOwned: ['probe', 'damper'],
      softsSlotted: ['probe'],
      wintermuteDebt: 3,
      dixieErased: false,
      flags: { metFinn: true, tookDeal: false },
    };
    a.data.settings.reduceFlashing = false;
    a.data.settings.audio.music = 0.25;
    expect(a.commit()).toBe(true);

    const b = createSaveStore({ storage });
    expect(b.load()).toBe('loaded');
    expect(b.data).toEqual(a.data);
    expect(JSON.parse(storage.items.get(SAVE_KEY)!).version).toBe(SAVE_VERSION);
  });

  it('repairs invalid fields individually instead of discarding the save', () => {
    const json = JSON.stringify({
      version: SAVE_VERSION,
      campaign: {
        act: 9,
        missionId: 'm2',
        heat: -5,
        scars: 1.5,
        softsOwned: 'oops',
        flags: { a: 1 },
      },
      settings: { audio: { master: 7 }, difficulty: 'hard' },
    });
    const { status, data } = parseSave(json);
    expect(status).toBe('loaded');
    expect(data.campaign.act).toBe(1);
    expect(data.campaign.missionId).toBe('m2');
    expect(data.campaign.heat).toBe(0);
    expect(data.campaign.scars).toBe(0);
    expect(data.campaign.softsOwned).toEqual([]);
    expect(data.campaign.flags).toEqual({});
    expect(data.settings.audio.master).toBe(1);
    expect(data.settings.difficulty).toBe('hard');
  });

  describe('migrations', () => {
    // A hypothetical history: v1 stored `heat` as 0–1; v2 moved it to 0–100;
    // v3 renamed `campaign.softs` to `softsOwned`.
    const migrations: Record<number, Migration> = {
      1: (d) => {
        const c = d.campaign as Record<string, unknown>;
        return { ...d, campaign: { ...c, heat: (c.heat as number) * 100 } };
      },
      2: (d) => {
        const { softs, ...c } = d.campaign as Record<string, unknown>;
        return { ...d, campaign: { ...c, softsOwned: softs } };
      },
    };
    const v1 = JSON.stringify({
      version: 1,
      campaign: { act: 2, missionId: 'm2', heat: 0.35, softs: ['probe'] },
      settings: { reduceMotion: true },
    });

    it('upgrades an old save step by step and writes it back at the current version', () => {
      const storage = createMemoryStorage();
      storage.setItem(SAVE_KEY, v1);
      const store = createSaveStore({ storage, version: 3, migrations });
      expect(store.load()).toBe('migrated');
      expect(store.data.version).toBe(3);
      expect(store.data.campaign).toMatchObject({ act: 2, heat: 35, softsOwned: ['probe'] });
      expect(store.data.campaign).not.toHaveProperty('softs');
      expect(store.data.settings.reduceMotion).toBe(true);

      const stored = JSON.parse(storage.items.get(SAVE_KEY)!);
      expect(stored.version).toBe(3);
      expect(createSaveStore({ storage, version: 3, migrations }).load()).toBe('loaded');
    });

    it('runs only the steps needed', () => {
      const first = vi.fn(migrations[1]!);
      const json = JSON.stringify({ version: 2, campaign: { softs: ['x'] }, settings: {} });
      const result = parseSave(json, { version: 3, migrations: { 1: first, 2: migrations[2]! } });
      expect(first).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'migrated', fromVersion: 2 });
      expect(result.data.campaign.softsOwned).toEqual(['x']);
    });

    it('backs up the blob when a migration step is missing or throws', () => {
      const storage = createMemoryStorage();
      storage.setItem(SAVE_KEY, v1);
      const store = createSaveStore({
        storage,
        version: 3,
        migrations: {
          ...migrations,
          2: () => {
            throw new Error('bad data');
          },
        },
      });
      expect(store.load()).toBe('corrupt');
      expect(storage.items.get(`${SAVE_KEY}.corrupt`)).toBe(v1);
      expect(store.data.campaign).toEqual(defaultCampaign());
      expect(parseSave(v1, { version: 3, migrations: { 1: migrations[1]! } }).status).toBe(
        'corrupt',
      );
    });

    it('production migrations cover every version below SAVE_VERSION', () => {
      for (let v = 1; v < SAVE_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function');
    });
  });

  it('keeps a save from a newer build instead of overwriting it', () => {
    const storage = createMemoryStorage();
    const future = JSON.stringify({ version: SAVE_VERSION + 1, campaign: {}, settings: {} });
    storage.setItem(SAVE_KEY, future);
    const store = createSaveStore({ storage });
    expect(store.load()).toBe('newer');
    expect(storage.items.get(`${SAVE_KEY}.v${SAVE_VERSION + 1}`)).toBe(future);
  });

  it('treats unreadable JSON and missing versions as corrupt', () => {
    expect(parseSave('{not json').status).toBe('corrupt');
    expect(parseSave('[]').status).toBe('corrupt');
    expect(parseSave('{"campaign":{}}').status).toBe('corrupt');
    expect(parseSave('{"version":0}').status).toBe('corrupt');
  });

  it('resetCampaign keeps settings; clear removes the save', () => {
    const storage = createMemoryStorage();
    const store = createSaveStore({ storage });
    store.load();
    store.data.campaign.act = 4;
    store.data.settings.reduceMotion = true;
    store.resetCampaign();
    expect(store.data.campaign.act).toBe(1);
    expect(createSaveStore({ storage }).load()).toBe('loaded');
    expect(JSON.parse(storage.items.get(SAVE_KEY)!).settings.reduceMotion).toBe(true);
    store.clear();
    expect(storage.items.has(SAVE_KEY)).toBe(false);
    expect(store.status).toBe('new');
  });

  it('survives storage that throws (quota, blocked access)', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = createSaveStore({ storage });
    expect(store.load()).toBe('new');
    expect(store.commit()).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  it('falls back to memory when no storage is available', () => {
    const store = createSaveStore({ storage: null });
    expect(store.persistent).toBe(false);
    store.load();
    expect(store.commit()).toBe(true);
  });
});

describe('settings store', () => {
  it('applies partial nested updates, notifies, and persists through the save', () => {
    const storage = createMemoryStorage();
    const save = createSaveStore({ storage });
    save.load();
    const settings = createSettingsStore(save.data.settings, (s) => {
      save.data.settings = s;
      save.commit();
    });
    const seen = vi.fn();
    const stop = settings.onChange(seen);
    const before = settings.value;

    settings.update({ audio: { music: 0.2 }, reduceFlashing: false });
    expect(settings.value.audio).toEqual({ ...before.audio, music: 0.2 });
    expect(settings.value.reduceFlashing).toBe(false);
    expect(settings.value).not.toBe(before);
    expect(seen).toHaveBeenCalledWith(settings.value, before);

    const reloaded = createSaveStore({ storage });
    reloaded.load();
    expect(reloaded.data.settings).toEqual(settings.value);

    stop();
    settings.reset();
    expect(seen).toHaveBeenCalledOnce();
    expect(settings.value).toEqual(defaultSettings());
  });

  it('clamps out-of-range values and rejects bad enum values', () => {
    const settings = createSettingsStore();
    settings.update({ input: { mouseSensitivity: 50 }, graphics: { quality: 'ultra' as never } });
    expect(settings.value.input.mouseSensitivity).toBe(5);
    expect(settings.value.graphics.quality).toBe('auto');
  });
});
