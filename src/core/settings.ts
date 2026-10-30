import { z } from 'zod';
import type { Unsubscribe } from './events';

/**
 * Player settings (plan §8.8–8.10). Persisted inside the save blob
 * (`core/save.ts`). Every field falls back to its default when missing or
 * invalid, and numbers are clamped, so a bad value never discards the rest.
 * Key bindings are owned by `input/bindings.ts` and are not stored here.
 */

export const DIFFICULTIES = ['story', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUALITY_SETTINGS = ['auto', 'low', 'medium', 'high'] as const;
export type QualitySetting = (typeof QUALITY_SETTINGS)[number];

export const SUBTITLE_SIZES = ['small', 'medium', 'large'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];

const num = (def: number, min: number, max: number) =>
  z
    .number()
    .transform((v) => Math.min(max, Math.max(min, v)))
    .catch(def);
const bool = (def: boolean) => z.boolean().catch(def);
const oneOf = <const T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.enum(values).catch(def);
const group = <S extends z.ZodRawShape>(shape: S) => {
  const schema = z.object(shape);
  return schema.catch(() => schema.parse({}));
};

export const settingsSchema = group({
  /** On by default and during the first-boot prompt until the player chooses (§8.10). */
  reduceFlashing: bool(true),
  /** Whether the first-boot flashing prompt has been answered. */
  flashingPromptAnswered: bool(false),
  reduceMotion: bool(false),
  holdToToggle: bool(false),
  difficulty: oneOf(DIFFICULTIES, 'normal'),
  subtitles: group({
    enabled: bool(true),
    size: oneOf(SUBTITLE_SIZES, 'medium'),
    /** Background box opacity, 0–1. */
    background: num(0.6, 0, 1),
  }),
  /** Phase Lock assists (§3.5, §8.10). `purist` removes ratio detents. */
  phaseLock: group({
    visualOnly: bool(false),
    widerTolerance: bool(false),
    mimicAlways: bool(false),
    slowerRekey: bool(false),
    purist: bool(false),
  }),
  /** Linear gains, 0–1. `pain` scales the simstim tinnitus tone (§7.5). */
  audio: group({
    master: num(0.8, 0, 1),
    music: num(0.7, 0, 1),
    sfx: num(0.8, 0, 1),
    voice: num(0.9, 0, 1),
    pain: num(0.5, 0, 1),
  }),
  input: group({
    mouseSensitivity: num(1, 0.1, 5),
    invertY: bool(false),
    gamepadDeadzone: num(0.15, 0, 0.5),
  }),
  graphics: group({
    quality: oneOf(QUALITY_SETTINGS, 'auto'),
    dynamicResolution: bool(true),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/** Validate untrusted data (e.g. a loaded save) into complete settings. */
export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(raw);
}

/** Merge a patch one level deep (settings groups are flat) and revalidate. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = merged[key];
    merged[key] =
      value !== null && typeof value === 'object' && prev !== null && typeof prev === 'object'
        ? { ...prev, ...value }
        : value;
  }
  return parseSettings(merged);
}

export type SettingsListener = (next: Readonly<Settings>, prev: Readonly<Settings>) => void;

export interface SettingsStore {
  /** Current settings. Replaced (never mutated) on every change, so references can be compared. */
  readonly value: Readonly<Settings>;
  update(patch: SettingsPatch): void;
  reset(): void;
  onChange(listener: SettingsListener): Unsubscribe;
}

/**
 * Holds live settings and notifies listeners. `persist` is called after each
 * change (the App wires it to the save store).
 */
export function createSettingsStore(
  initial: Settings = defaultSettings(),
  persist?: (s: Settings) => void,
): SettingsStore {
  let value = parseSettings(initial);
  const listeners = new Set<SettingsListener>();

  const set = (next: Settings): void => {
    const prev = value;
    value = next;
    persist?.(next);
    for (const fn of [...listeners]) fn(next, prev);
  };

  return {
    get value() {
      return value;
    },
    update(patch) {
      set(applySettingsPatch(value, patch));
    },
    reset() {
      set(defaultSettings());
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
