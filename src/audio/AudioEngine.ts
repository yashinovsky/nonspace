import type { CorpId } from '../content/corps';
import type { Vec3 } from '../core/math/vec3';

/** SFX ids for the plan §7.3 palette. Recipes are M5.2's (audio/sfx/catalog.ts). */
export const SFX_IDS = [
  'jackIn',
  'jackOut',
  'boost',
  'gridTick',
  'jump',
  'jumpArrive',
  'scan',
  'hullContact',
  'lockStep',
  'rekeyTelegraph',
  'shatter',
  'traceTick',
  'burned',
  'flatline',
  'simstimFlip',
  'kuang',
  'kuangSting',
  'wintermuteHijack',
  'neuromancerSoften',
  'deckError',
  'uiClick',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

/** Adaptive music states (plan §7.2). */
export const MUSIC_STATES = [
  'silent',
  'transit',
  'approach',
  'breach',
  'grip',
  'core',
  'simstim',
  'kuangDive',
  'beach',
] as const;
export type MusicState = (typeof MUSIC_STATES)[number];

export type MusicMode = 'minor' | 'dorian' | 'lydian';
export type AudioBus = 'all' | 'music';

/** Opaque motif handle. */
export type Handle = number & { readonly __brand: 'AudioHandle' };

export interface SfxOptions {
  pos?: Vec3;
  gain?: number;
  pitch?: number;
}

/**
 * Audio API (plan §9.7). The real engine is M5.1's; until then, and in tests,
 * use createNoopAudioEngine(). Every method is safe to call before unlock().
 */
export interface AudioEngine {
  /** Call on the first user gesture. */
  unlock(): Promise<void>;
  sfx(id: SfxId, opts?: SfxOptions): void;
  music: {
    setState(s: MusicState): void;
    setTempo(bpm: number): void;
    setKey(root: number, mode: MusicMode): void;
  };
  motif: {
    attach(landmarkId: string, pos: Vec3, corp: CorpId): Handle;
    detach(h: Handle): void;
  };
  phaseLock: {
    start(a: number, b: number, f0: number): void;
    setTarget(a: number, b: number, phi: number): void;
    setPlayer(R: number, Phi: number): void;
    stop(): void;
  };
  modem: { start(): void; stop(): void };
  duck(bus: AudioBus, db: number, seconds: number): void;
  listener(pos: Vec3, forward: Vec3, up: Vec3): void;
}

/** Silent engine with the full API. Fresh object per call, so spies don't leak across tests. */
export function createNoopAudioEngine(): AudioEngine {
  let nextHandle = 1;
  return {
    unlock: () => Promise.resolve(),
    sfx: () => {},
    music: { setState: () => {}, setTempo: () => {}, setKey: () => {} },
    motif: { attach: () => nextHandle++ as Handle, detach: () => {} },
    phaseLock: { start: () => {}, setTarget: () => {}, setPlayer: () => {}, stop: () => {} },
    modem: { start: () => {}, stop: () => {} },
    duck: () => {},
    listener: () => {},
  };
}
