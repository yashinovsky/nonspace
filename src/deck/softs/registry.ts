import type { IceModel, IceSoftMods } from '../../breach/IceModel';
import type { EventBus } from '../../core/events';
import type { Vec3 } from '../../core/math/vec3';
import {
  DEFAULT_SOFT_SLOTS,
  getSoft,
  ratioLabel,
  SOFTS,
  type SoftDef,
  type SoftEffect,
} from '../../content/softs';
import type { SoftSlot } from '../../hud/VfdStrip';
import {
  applyClamp,
  applyKuang,
  applyMimicToIce,
  idleIceMods,
  type DecoyLure,
  type MimicKnobs,
  type WatcherLureSink,
} from './effects';

export const SLOT_COUNT = 4;

/** `H` / `askDixie` identity. Not a `SoftDef` — M7.2 owns the companion. */
export const DIXIE_READ_ID = 'dixie-read';

/**
 * M7.2 Dixie companion implements this. M4.4 only forwards `H` (`askDixie`).
 * Missing API is a no-op — no barks, 4 s delay, ratio line, auto-hold, or erase.
 */
export interface DixieReadApi {
  read(ice: IceModel | null): boolean;
}

export type SoftUseFail =
  | 'unknown'
  | 'locked'
  | 'empty'
  | 'cooldown'
  | 'no-ice'
  | 'mimic-spent'
  | 'no-companion'
  | 'dixie-away';

export interface SoftUseResult {
  ok: boolean;
  softId: string;
  fail?: SoftUseFail;
}

export interface SoftsWorld {
  ice?: IceModel | null;
  knobs?: MimicKnobs;
  player?: Vec3;
  events?: EventBus;
  lure?: WatcherLureSink | null;
  /** Optional M7.2 companion. `askDixie` no-ops when absent. */
  dixie?: DixieReadApi | null;
}

export interface SoftsRunState {
  t: number;
  slots: string[];
  charges: Record<string, number>;
  cooldowns: Record<string, number>;
  mimicLayers: string[];
  kuangSpent: boolean;
  mimicAlways: boolean;
  flags: Record<string, boolean>;
  act: number;
  reveal: { remaining: number; label: string; a: number; b: number } | null;
  clampRemaining: number;
  damper: { remaining: number; feedbackMul: number } | null;
  decoy: DecoyLure | null;
  mimic: { layerKey: string; rate: number } | null;
}

export interface SoftsRuntime {
  readonly t: number;
  readonly slots: readonly string[];
  readonly revealLabel: string | null;
  readonly decoy: DecoyLure | null;
  readonly iceMods: IceSoftMods;
  readonly hudSlots: readonly SoftSlot[];
  beginRun(opts?: BeginRunOpts): void;
  setSlot(index: number, softId: string | null): void;
  setMimicAlways(on: boolean): void;
  unlockAll(): void;
  chargesLeft(softId: string): number | undefined;
  cooldownLeft(softId: string): number;
  canUse(softId: string, world?: SoftsWorld): SoftUseFail | null;
  use(softId: string, world?: SoftsWorld): SoftUseResult;
  useSlot(index: number, world?: SoftsWorld): SoftUseResult;
  askDixie(world?: SoftsWorld): SoftUseResult;
  handleInput(
    pressed: (action: 'soft1' | 'soft2' | 'soft3' | 'soft4' | 'askDixie') => boolean,
    world?: SoftsWorld,
  ): void;
  step(dt: number, world?: SoftsWorld): void;
  applyMimic(knobs: MimicKnobs, ice: IceModel, dt: number): void;
  snapshot(): SoftsRunState;
  restore(state: SoftsRunState): void;
}

export interface BeginRunOpts {
  slots?: readonly string[];
  flags?: Record<string, boolean>;
  act?: number;
  mimicAlways?: boolean;
}

function mimicKey(ice: IceModel): string {
  return `${ice.def.id}:${ice.state.current.index}`;
}

function isUnlocked(
  def: SoftDef,
  flags: Record<string, boolean>,
  act: number,
  mimicAlways: boolean,
): boolean {
  if (def.unlock === 'start') return true;
  if (def.id === 'mimic' && mimicAlways) return true;
  if (flags[def.unlock] === true) return true;
  if (def.unlock === 'act2' && act >= 2) return true;
  return false;
}

function needsIce(effect: SoftEffect): boolean {
  return (
    effect.kind === 'revealRatio' ||
    effect.kind === 'freezeDrift' ||
    effect.kind === 'damper' ||
    effect.kind === 'mimic' ||
    effect.kind === 'kuang'
  );
}

function emptySlot(): SoftSlot {
  return { label: '--', cooldown: 0 };
}

/**
 * Per-run soft loadout (plan §3.5 / §9.4). Charges and cooldowns live here for
 * the jack-in; `beginRun` resets them. Campaign ownership stays on the save.
 */
export function createSoftsRuntime(opts: BeginRunOpts = {}): SoftsRuntime {
  const slots: string[] = ['', '', '', ''];
  const hud: SoftSlot[] = [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
  const charges = new Map<string, number>();
  const cooldowns = new Map<string, number>();
  const mimicSpent = new Set<string>();
  const mods: IceSoftMods = { freezeDrift: false, feedbackMul: 1, traceMul: 1 };

  let t = 0;
  let flags: Record<string, boolean> = {};
  let act = 1;
  let mimicAlways = false;
  let kuangSpent = false;
  let reveal: SoftsRunState['reveal'] = null;
  let clampRemaining = 0;
  let damper: SoftsRunState['damper'] = null;
  let decoy: DecoyLure | null = null;
  let mimic: SoftsRunState['mimic'] = null;

  const refillCharges = (): void => {
    charges.clear();
    cooldowns.clear();
    for (const def of SOFTS) {
      if (def.charges !== undefined) charges.set(def.id, def.charges);
    }
  };

  const paintHud = (): void => {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = slots[i]!;
      const slot = hud[i]!;
      const def = id ? getSoft(id) : undefined;
      if (!def) {
        slot.label = '--';
        slot.cooldown = 0;
        continue;
      }
      const left = charges.get(def.id);
      if (def.charges !== undefined && (left ?? 0) <= 0) {
        slot.label = '--';
        slot.cooldown = 0;
        continue;
      }
      slot.label = def.name;
      const cdMax = def.cooldown ?? 0;
      const cd = cooldowns.get(def.id) ?? 0;
      slot.cooldown = cdMax > 0 ? Math.min(1, Math.max(0, cd / cdMax)) : 0;
    }
  };

  const syncMods = (): void => {
    idleIceMods(mods);
    if (clampRemaining > 0) mods.freezeDrift = true;
    if (damper && damper.remaining > 0) mods.feedbackMul = damper.feedbackMul;
    if (decoy && decoy.remaining > 0) mods.traceMul = decoy.traceMul;
  };

  const api: SoftsRuntime = {
    get t() {
      return t;
    },
    get slots() {
      return slots;
    },
    get revealLabel() {
      return reveal && reveal.remaining > 0 ? reveal.label : null;
    },
    get decoy() {
      return decoy && decoy.remaining > 0 ? decoy : null;
    },
    get iceMods() {
      return mods;
    },
    get hudSlots() {
      return hud;
    },
    beginRun(next = {}) {
      t = 0;
      act = next.act ?? opts.act ?? 1;
      flags = { ...(next.flags ?? opts.flags ?? {}) };
      mimicAlways = next.mimicAlways ?? opts.mimicAlways ?? false;
      const load = next.slots ?? opts.slots ?? DEFAULT_SOFT_SLOTS;
      for (let i = 0; i < SLOT_COUNT; i++) slots[i] = load[i] ?? '';
      refillCharges();
      mimicSpent.clear();
      kuangSpent = false;
      reveal = null;
      clampRemaining = 0;
      damper = null;
      decoy = null;
      mimic = null;
      syncMods();
      paintHud();
    },
    setSlot(index, softId) {
      const i = index | 0;
      if (i < 0 || i >= SLOT_COUNT) return;
      slots[i] = softId ?? '';
      paintHud();
    },
    setMimicAlways(on) {
      mimicAlways = on;
    },
    unlockAll() {
      act = 5;
      flags = { ...flags, act2: true, m5: true };
      mimicAlways = true;
    },
    chargesLeft(softId) {
      return charges.get(softId);
    },
    cooldownLeft(softId) {
      return cooldowns.get(softId) ?? 0;
    },
    canUse(softId, world) {
      const def = getSoft(softId);
      if (!def) return 'unknown';
      if (!isUnlocked(def, flags, act, mimicAlways)) return 'locked';
      if (def.charges !== undefined && (charges.get(def.id) ?? 0) <= 0) return 'empty';
      if (needsIce(def.effect) && (!world?.ice || world.ice.state.status !== 'engaged')) {
        return 'no-ice';
      }
      if ((cooldowns.get(def.id) ?? 0) > 1e-6) return 'cooldown';
      if (def.effect.kind === 'mimic') {
        const ice = world?.ice;
        if (!ice || ice.state.status !== 'engaged') return 'no-ice';
        if (mimicSpent.has(mimicKey(ice))) return 'mimic-spent';
      }
      if (def.effect.kind === 'kuang' && kuangSpent) return 'empty';
      return null;
    },
    use(softId, world) {
      const fail = api.canUse(softId, world);
      if (fail) return { ok: false, softId, fail };
      const def = getSoft(softId)!;
      applyEffect(def.effect, world?.ice ?? null, world);
      if (def.charges !== undefined) {
        charges.set(def.id, Math.max(0, (charges.get(def.id) ?? 0) - 1));
      }
      if (def.cooldown && def.cooldown > 0) cooldowns.set(def.id, def.cooldown);
      if (def.effect.kind === 'kuang') kuangSpent = true;
      world?.events?.post({ type: 'softUsed', softId: def.id });
      syncMods();
      paintHud();
      return { ok: true, softId: def.id };
    },
    useSlot(index, world) {
      const id = slots[index | 0];
      if (!id) return { ok: false, softId: '', fail: 'empty' };
      return api.use(id, world);
    },
    askDixie(world) {
      const read = world?.dixie?.read;
      if (!read) return { ok: false, softId: DIXIE_READ_ID, fail: 'no-companion' };
      const ok = read(world?.ice ?? null);
      return ok
        ? { ok: true, softId: DIXIE_READ_ID }
        : { ok: false, softId: DIXIE_READ_ID, fail: 'dixie-away' };
    },
    handleInput(pressed, world) {
      if (pressed('soft1')) api.useSlot(0, world);
      if (pressed('soft2')) api.useSlot(1, world);
      if (pressed('soft3')) api.useSlot(2, world);
      if (pressed('soft4')) api.useSlot(3, world);
      if (pressed('askDixie')) api.askDixie(world);
    },
    step(dt, world) {
      if (!(dt > 0)) {
        syncMods();
        paintHud();
        return;
      }
      t += dt;
      for (const [id, left] of cooldowns) {
        const next = left - dt;
        if (next <= 0) cooldowns.delete(id);
        else cooldowns.set(id, next);
      }
      if (reveal) {
        reveal.remaining -= dt;
        if (reveal.remaining <= 0) reveal = null;
      }
      if (clampRemaining > 0) {
        clampRemaining -= dt;
        if (clampRemaining < 0) clampRemaining = 0;
      }
      if (damper) {
        damper.remaining -= dt;
        if (damper.remaining <= 0) damper = null;
      }
      if (decoy) {
        decoy.remaining -= dt;
        if (decoy.remaining <= 0) {
          decoy = null;
          world?.lure?.setLure(null);
        } else {
          world?.lure?.setLure(decoy);
        }
      }
      const ice = world?.ice ?? null;
      if (mimic) {
        if (!ice || ice.state.status !== 'engaged' || mimicKey(ice) !== mimic.layerKey) {
          mimic = null;
        } else if (world?.knobs) {
          applyMimicToIce(world.knobs, ice, mimic.rate, dt);
        }
      }
      syncMods();
      paintHud();
    },
    applyMimic(knobs, ice, dt) {
      if (!mimic || mimicKey(ice) !== mimic.layerKey) return;
      applyMimicToIce(knobs, ice, mimic.rate, dt);
    },
    snapshot() {
      const chargeDump: Record<string, number> = {};
      for (const [k, v] of charges) chargeDump[k] = v;
      const cdDump: Record<string, number> = {};
      for (const [k, v] of cooldowns) cdDump[k] = v;
      return {
        t,
        slots: slots.slice(),
        charges: chargeDump,
        cooldowns: cdDump,
        mimicLayers: [...mimicSpent],
        kuangSpent,
        mimicAlways,
        flags: { ...flags },
        act,
        reveal: reveal ? { ...reveal } : null,
        clampRemaining,
        damper: damper ? { ...damper } : null,
        decoy: decoy ? { ...decoy } : null,
        mimic: mimic ? { ...mimic } : null,
      };
    },
    restore(state) {
      t = state.t;
      for (let i = 0; i < SLOT_COUNT; i++) slots[i] = state.slots[i] ?? '';
      charges.clear();
      for (const [k, v] of Object.entries(state.charges)) charges.set(k, v);
      cooldowns.clear();
      for (const [k, v] of Object.entries(state.cooldowns)) cooldowns.set(k, v);
      mimicSpent.clear();
      for (const k of state.mimicLayers) mimicSpent.add(k);
      kuangSpent = state.kuangSpent;
      mimicAlways = state.mimicAlways;
      flags = { ...state.flags };
      act = state.act;
      reveal = state.reveal ? { ...state.reveal } : null;
      clampRemaining = state.clampRemaining;
      damper = state.damper ? { ...state.damper } : null;
      decoy = state.decoy ? { ...state.decoy } : null;
      mimic = state.mimic ? { ...state.mimic } : null;
      syncMods();
      paintHud();
    },
  };

  const applyEffect = (effect: SoftEffect, ice: IceModel | null, world?: SoftsWorld): void => {
    if (effect.kind === 'revealRatio') {
      if (!ice) return;
      const [a, b] = ice.state.current.ratio;
      reveal = { remaining: effect.seconds, label: ratioLabel(a, b), a, b };
      return;
    }
    if (effect.kind === 'freezeDrift') {
      if (!ice) return;
      clampRemaining = effect.seconds;
      applyClamp(ice, effect.delayRekey);
      return;
    }
    if (effect.kind === 'damper') {
      damper = { remaining: effect.seconds, feedbackMul: effect.feedbackMul };
      return;
    }
    if (effect.kind === 'decoy') {
      const p = world?.player;
      decoy = {
        remaining: effect.seconds,
        x: p ? p.x : 8,
        y: p ? p.y + 2 : 4,
        z: p ? p.z - 10 : -8,
        traceMul: effect.traceMul,
      };
      world?.lure?.setLure(decoy);
      return;
    }
    if (effect.kind === 'mimic') {
      if (!ice) return;
      const key = mimicKey(ice);
      mimicSpent.add(key);
      mimic = { layerKey: key, rate: effect.rate };
      return;
    }
    if (effect.kind === 'kuang' && ice) applyKuang(ice);
  };

  api.beginRun(opts);
  return api;
}
