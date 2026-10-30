import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createMemoryStorage,
  createSaveStore,
  defaultCampaign,
  defaultSave,
  parseSave,
  SAVE_KEY,
  SAVE_VERSION,
  type Migration,
} from '../../src/core/save';
import { defaultSettings } from '../../src/core/settings';

const dir = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string): string =>
  readFileSync(resolve(dir, 'fixtures/saves', name), 'utf8');

const v1Full = loadFixture('v1-full.json');
const v1Partial = loadFixture('v1-partial.json');
const v1Legacy = loadFixture('v1-legacy.json');

describe('save migration (versioned localStorage JSON)', () => {
  it('loads a complete v1 campaign+settings blob at SAVE_VERSION', () => {
    expect(SAVE_VERSION).toBe(1);
    const { status, data, fromVersion } = parseSave(v1Full);
    expect(status).toBe('loaded');
    expect(fromVersion).toBe(1);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.campaign).toMatchObject({
      act: 5,
      missionId: 'm7',
      checkpoint: 'merge',
      heat: 42.5,
      scars: 2,
      flatlines: 3,
      softsOwned: ['probe', 'clamp', 'kuang'],
      softsSlotted: ['probe', 'kuang'],
      wintermuteDebt: 1,
      dixieErased: true,
      flags: { endingA: true, complete: true, beachLeft: true, metFinn: true },
    });
    expect(data.settings).toMatchObject({
      reduceFlashing: false,
      flashingPromptAnswered: true,
      reduceMotion: true,
      holdToToggle: true,
      difficulty: 'hard',
      subtitles: { enabled: true, size: 'large', background: 0.4 },
      phaseLock: {
        visualOnly: true,
        widerTolerance: true,
        mimicAlways: false,
        slowerRekey: true,
        purist: false,
      },
      audio: { master: 0.5, music: 0.2, sfx: 0.7, voice: 0.9, pain: 0.1 },
      input: { mouseSensitivity: 1.5, invertY: true, gamepadDeadzone: 0.2 },
      graphics: { quality: 'medium', dynamicResolution: false },
    });
  });

  it('fills missing campaign and settings groups from a sparse v1 blob', () => {
    const { status, data } = parseSave(v1Partial);
    expect(status).toBe('loaded');
    expect(data.campaign.act).toBe(2);
    expect(data.campaign.missionId).toBe('m3');
    expect(data.campaign.checkpoint).toBeNull();
    expect(data.campaign.heat).toBe(0);
    expect(data.campaign.flags).toEqual({ onboarded: true });
    expect(data.campaign.softsOwned).toEqual([]);
    expect(data.settings.difficulty).toBe('story');
    expect(data.settings.audio.music).toBe(0.15);
    expect(data.settings.audio.master).toBe(defaultSettings().audio.master);
    expect(data.settings.graphics).toEqual(defaultSettings().graphics);
  });

  it('round-trips campaign+settings through the localStorage key', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, v1Full);
    const a = createSaveStore({ storage });
    expect(a.load()).toBe('loaded');
    a.data.campaign.checkpoint = 'erase';
    a.data.settings.audio.sfx = 0.33;
    expect(a.commit()).toBe(true);

    const stored = JSON.parse(storage.items.get(SAVE_KEY)!) as {
      version: number;
      campaign: { checkpoint: string };
      settings: { audio: { sfx: number } };
    };
    expect(stored.version).toBe(SAVE_VERSION);
    expect(stored.campaign.checkpoint).toBe('erase');
    expect(stored.settings.audio.sfx).toBe(0.33);

    const b = createSaveStore({ storage });
    expect(b.load()).toBe('loaded');
    expect(b.data.campaign.checkpoint).toBe('erase');
    expect(b.data.settings.audio.sfx).toBe(0.33);
    expect(b.data.campaign.flags.endingA).toBe(true);
  });

  it('migrates a legacy v1 JSON shape (renamed campaign + settings keys)', () => {
    const migrations: Record<number, Migration> = {
      1: (d) => {
        const c = { ...(d.campaign as Record<string, unknown>) };
        const s = { ...(d.settings as Record<string, unknown>) };
        const heat = typeof c.heat === 'number' ? c.heat * 100 : 0;
        const softs = Array.isArray(c.softs) ? c.softs : [];
        delete c.softs;
        const sound = s.sound as { vol?: number } | undefined;
        const gfx = s.gfx as { quality?: string } | undefined;
        delete s.sound;
        delete s.gfx;
        return {
          ...d,
          campaign: { ...c, heat, softsOwned: softs },
          settings: {
            ...s,
            audio: { master: sound?.vol ?? 0.8 },
            graphics: { quality: gfx?.quality ?? 'auto' },
          },
        };
      },
    };
    const { status, data, fromVersion } = parseSave(v1Legacy, { version: 2, migrations });
    expect(status).toBe('migrated');
    expect(fromVersion).toBe(1);
    expect(data.version).toBe(2);
    expect(data.campaign).toMatchObject({
      act: 2,
      missionId: 'm2',
      heat: 42,
      softsOwned: ['probe', 'clamp'],
      flags: { metFinn: true },
    });
    expect(data.campaign).not.toHaveProperty('softs');
    expect(data.settings.reduceMotion).toBe(true);
    expect(data.settings.audio.master).toBe(0.25);
    expect(data.settings.graphics.quality).toBe('low');

    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, v1Legacy);
    const store = createSaveStore({ storage, version: 2, migrations });
    expect(store.load()).toBe('migrated');
    expect(JSON.parse(storage.items.get(SAVE_KEY)!).version).toBe(2);
    expect(createSaveStore({ storage, version: 2, migrations }).load()).toBe('loaded');
  });

  it('keeps current-version defaults when the blob is empty-shaped', () => {
    const json = JSON.stringify({ version: SAVE_VERSION, campaign: {}, settings: {} });
    const { status, data } = parseSave(json);
    expect(status).toBe('loaded');
    expect(data.campaign).toEqual(defaultCampaign());
    expect(data.settings).toEqual(defaultSettings());
    expect(data).toEqual(defaultSave());
  });
});
