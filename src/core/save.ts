import { z } from 'zod';
import { defaultSettings, settingsSchema, type Settings } from './settings';

/**
 * Versioned save in localStorage (plan §8.9):
 * `{ version, campaign: {...}, settings: {...} }`.
 *
 * Loading runs migrations from the stored version up to `SAVE_VERSION`, then
 * validates field by field (bad fields fall back to defaults). A blob that
 * can't be parsed or migrated, or that comes from a newer build, is copied to
 * a backup key and the game starts from defaults rather than overwriting it.
 */

export const SAVE_KEY = 'nonspace.save';
export const SAVE_VERSION = 1;

/** Upgrades a blob from version n to n + 1 (the blob's `version` is set by the runner). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades version n to n + 1. When bumping `SAVE_VERSION`,
 * add the step here and a fixture of the old shape to `tests/unit/fixtures/saves/`
 * (`tests/unit/saveMigration.test.ts`).
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

const count = z.number().int().min(0).catch(0);
const optionalId = z.string().min(1).nullable().catch(null);
const ids = z.array(z.string()).catch(() => []);

const campaignShape = z.object({
  act: z.number().int().min(1).max(5).catch(1),
  missionId: optionalId,
  checkpoint: optionalId,
  heat: z.number().min(0).catch(0),
  scars: count,
  flatlines: count,
  softsOwned: ids,
  softsSlotted: ids,
  wintermuteDebt: z.number().min(0).catch(0),
  dixieErased: z.boolean().optional().catch(undefined),
  /** Mission `setFlag` values and soft unlock flags (`SoftDef.unlock`). */
  flags: z.record(z.string(), z.boolean()).catch(() => ({})),
});
export const campaignSchema = campaignShape.catch(() => campaignShape.parse({}));

export type CampaignState = z.infer<typeof campaignSchema>;

export interface SaveData {
  version: number;
  campaign: CampaignState;
  settings: Settings;
}

export function defaultCampaign(): CampaignState {
  return campaignSchema.parse({});
}

export function defaultSave(version = SAVE_VERSION): SaveData {
  return { version, campaign: defaultCampaign(), settings: defaultSettings() };
}

/**
 * `new`: nothing stored. `loaded`: current version. `migrated`: upgraded from
 * an older version. `corrupt`: unreadable or a migration failed. `newer`:
 * written by a newer build. The last two back up the raw blob first.
 */
export type LoadStatus = 'new' | 'loaded' | 'migrated' | 'corrupt' | 'newer';

export interface ParseResult {
  status: LoadStatus;
  data: SaveData;
  /** Version found in storage, when readable. */
  fromVersion?: number;
  error?: string;
}

export interface SaveFormat {
  version?: number;
  migrations?: Readonly<Record<number, Migration>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pure: raw stored JSON (or null) to validated current-version data. */
export function parseSave(json: string | null, format: SaveFormat = {}): ParseResult {
  const version = format.version ?? SAVE_VERSION;
  const migrations = format.migrations ?? MIGRATIONS;
  if (json === null) return { status: 'new', data: defaultSave(version) };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { status: 'corrupt', data: defaultSave(version), error: String(err) };
  }
  if (!isRecord(raw) || !Number.isInteger(raw.version) || (raw.version as number) < 1) {
    return { status: 'corrupt', data: defaultSave(version), error: 'missing or invalid version' };
  }

  const fromVersion = raw.version as number;
  if (fromVersion > version) {
    return { status: 'newer', data: defaultSave(version), fromVersion };
  }

  let data: Record<string, unknown> = raw;
  try {
    for (let v = fromVersion; v < version; v++) {
      const migrate = migrations[v];
      if (!migrate) throw new Error(`no save migration from version ${v}`);
      data = { ...migrate(structuredClone(data)), version: v + 1 };
    }
  } catch (err) {
    return { status: 'corrupt', data: defaultSave(version), fromVersion, error: String(err) };
  }

  return {
    status: fromVersion === version ? 'loaded' : 'migrated',
    data: {
      version,
      campaign: campaignSchema.parse(data.campaign),
      settings: settingsSchema.parse(data.settings),
    },
    fromVersion,
  };
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createMemoryStorage(): StorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
  };
}

/** `window.localStorage`, or null where it's missing or blocked (some private modes throw on access). */
export function browserStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__nonspace_probe__';
    s.setItem(probe, probe);
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export interface SaveStore {
  readonly key: string;
  /** Live save data. Mutate `campaign`/`settings`, then `commit()`. */
  data: SaveData;
  /** Result of the last `load()`. */
  readonly status: LoadStatus;
  /** False when storage is unavailable and saves only live in memory. */
  readonly persistent: boolean;
  load(): LoadStatus;
  /** Write `data`. Returns false if storage rejected it (e.g. quota). */
  commit(): boolean;
  /** New game: default campaign, settings kept. Commits. */
  resetCampaign(): void;
  /** Delete the stored save and return to defaults. */
  clear(): void;
}

export interface SaveStoreOptions extends SaveFormat {
  /** Defaults to `browserStorage()`, falling back to memory. */
  storage?: StorageLike | null;
  key?: string;
}

export function backupKey(key: string, status: 'corrupt' | 'newer', fromVersion?: number): string {
  return status === 'newer' ? `${key}.v${fromVersion}` : `${key}.corrupt`;
}

export function createSaveStore(opts: SaveStoreOptions = {}): SaveStore {
  const key = opts.key ?? SAVE_KEY;
  const version = opts.version ?? SAVE_VERSION;
  const format: SaveFormat = { version, migrations: opts.migrations ?? MIGRATIONS };
  const real = opts.storage === undefined ? browserStorage() : opts.storage;
  const storage = real ?? createMemoryStorage();

  const write = (k: string, value: string): boolean => {
    try {
      storage.setItem(k, value);
      return true;
    } catch {
      return false;
    }
  };

  let status: LoadStatus = 'new';
  const store: SaveStore = {
    key,
    data: defaultSave(version),
    get status() {
      return status;
    },
    persistent: real !== null,
    load() {
      let json: string | null;
      try {
        json = storage.getItem(key);
      } catch {
        json = null;
      }
      const result = parseSave(json, format);
      status = result.status;
      store.data = result.data;
      if ((status === 'corrupt' || status === 'newer') && json !== null) {
        write(backupKey(key, status, result.fromVersion), json);
      }
      if (status === 'migrated') store.commit();
      return status;
    },
    commit() {
      store.data.version = version;
      return write(key, JSON.stringify(store.data));
    },
    resetCampaign() {
      store.data.campaign = defaultCampaign();
      store.commit();
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        // Nothing stored or storage is gone; defaults below either way.
      }
      store.data = defaultSave(version);
      status = 'new';
    },
  };
  return store;
}
