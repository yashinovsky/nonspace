import type { SaveStore } from '../core/save';
import { createPhoneRing, type PhoneRingHook } from '../meat/phoneRing';
import { bloomRadiusForWintermute } from '../render/post/BloomPass';
import type { PersistencePass } from '../render/post/PersistencePass';
import type { Palette } from '../render/palette';

/**
 * Wintermute behaviors from plan §3.8. Each action is reversible:
 * `on: false` / `amount: 0` / empty bend restores the untouched state.
 */
export type WintermuteAction =
  | { kind: 'hijack'; text: string }
  | { kind: 'overexpose'; amount: number; seconds?: number }
  | { kind: 'freeze'; on: boolean }
  | { kind: 'gridBend'; points: Array<{ x: number; z: number; strength: number }> }
  | { kind: 'persona'; who: string; on: boolean }
  | { kind: 'ringPhones'; on: boolean }
  | { kind: 'bargain'; offerId: string; debt: number };

/** Upper bound on warp control points the grid shader accepts (plan §8.5). */
export const MAX_GRID_BEND_POINTS = 4;
export const DEFAULT_WARP_RADIUS = 160;

export interface WarpBend {
  x: number;
  z: number;
  strength: number;
  radius?: number;
}

export function corridorBend(strength = 0.75): WarpBend[] {
  return [
    { x: -48, z: 40, strength },
    { x: 48, z: 40, strength },
    { x: -56, z: -90, strength: strength * 0.85 },
    { x: 56, z: -90, strength: strength * 0.85 },
  ];
}

export function gridBendToWarp(points: readonly WarpBend[]): Array<{
  x: number;
  z: number;
  radius: number;
  strength: number;
}> {
  const out = [];
  for (let i = 0; i < MAX_GRID_BEND_POINTS; i++) {
    const p = points[i];
    if (!p) out.push({ x: 0, z: 0, radius: 1, strength: 0 });
    else
      out.push({
        x: p.x,
        z: p.z,
        radius: p.radius && p.radius > 0 ? p.radius : DEFAULT_WARP_RADIUS,
        strength: p.strength,
      });
  }
  return out;
}

const ZERO_WARP = gridBendToWarp([]);

export interface WintermuteHost {
  palette: Palette;
  renderer: {
    exposure: number;
    bloomRadius?: number;
    chain: { getPass(slot: string): unknown };
  };
  save?: SaveStore;
  grid?: {
    setWarp(points: readonly { x: number; z: number; radius: number; strength: number }[]): void;
  };
  ice?: { setFrozen(on: boolean): void };
  hud?: {
    print(text: string, opts?: { wintermute?: boolean }): void;
    hijack?(text: string | null): void;
  };
  phones?: PhoneRingHook;
  persona?: { setWho(who: string | null, on?: boolean): void };
}

export interface Wintermute {
  apply(action: WintermuteAction): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  readonly overexpose: number;
  readonly frozen: boolean;
  readonly hijackText: string;
  readonly personaWho: string | null;
  readonly phonesOn: boolean;
  readonly debt: number;
  readonly warpOn: boolean;
  readonly bargainId: string | null;
}

function persistPass(host: WintermuteHost): PersistencePass | null {
  const pass = host.renderer.chain.getPass('persistence') as
    PersistencePass | { decayScale?: number };
  if (pass && typeof pass.decayScale === 'number') return pass as PersistencePass;
  return null;
}

export function createWintermute(host: WintermuteHost): Wintermute {
  let overCurrent = 0;
  let overTarget = 0;
  let overRate = 0;
  let frozen = false;
  let hijackText = '';
  let personaWho: string | null = null;
  let phonesOn = false;
  let warpOn = false;
  let bargainId: string | null = null;
  const ownedPhones = host.phones ?? createPhoneRing();
  const ownPhones = !host.phones;

  const applyOverexpose = (amount: number): void => {
    const t = Math.min(1, Math.max(0, amount));
    host.palette.lerpAllTo({ r: 1, g: 1, b: 1 }, t);
    host.renderer.exposure = 1 + t;
    host.renderer.bloomRadius = t > 1e-4 ? bloomRadiusForWintermute(t) : undefined;
  };

  const api: Wintermute = {
    get overexpose() {
      return overCurrent;
    },
    get frozen() {
      return frozen;
    },
    get hijackText() {
      return hijackText;
    },
    get personaWho() {
      return personaWho;
    },
    get phonesOn() {
      return phonesOn;
    },
    get debt() {
      return host.save?.data.campaign.wintermuteDebt ?? 0;
    },
    get warpOn() {
      return warpOn;
    },
    get bargainId() {
      return bargainId;
    },
    apply(action) {
      switch (action.kind) {
        case 'hijack': {
          hijackText = action.text;
          host.hud?.print(action.text, { wintermute: true });
          host.hud?.hijack?.(action.text);
          break;
        }
        case 'overexpose': {
          overTarget = Math.min(1, Math.max(0, action.amount));
          const sec = action.seconds ?? 0;
          overRate = sec > 1e-4 ? Math.abs(overTarget - overCurrent) / sec : 0;
          if (overRate === 0) {
            overCurrent = overTarget;
            applyOverexpose(overCurrent);
          }
          break;
        }
        case 'freeze': {
          frozen = action.on;
          host.ice?.setFrozen(frozen);
          const persist = persistPass(host);
          if (persist) persist.decayScale = frozen ? 0 : 1;
          break;
        }
        case 'gridBend': {
          const pts = action.points.filter((p) => p.strength !== 0);
          warpOn = pts.length > 0;
          host.grid?.setWarp(warpOn ? gridBendToWarp(action.points) : ZERO_WARP);
          break;
        }
        case 'persona': {
          personaWho = action.on ? action.who : null;
          host.persona?.setWho(action.on ? action.who : null, action.on);
          break;
        }
        case 'ringPhones': {
          phonesOn = action.on;
          if (phonesOn) ownedPhones.start();
          else ownedPhones.stop();
          break;
        }
        case 'bargain': {
          bargainId = action.offerId;
          if (host.save) {
            host.save.data.campaign.wintermuteDebt += Math.max(0, action.debt);
            host.save.commit();
          }
          break;
        }
      }
    },
    update(dt) {
      if (overRate > 0 && overCurrent !== overTarget) {
        const step = overRate * Math.max(0, dt);
        if (overCurrent < overTarget) overCurrent = Math.min(overTarget, overCurrent + step);
        else overCurrent = Math.max(overTarget, overCurrent - step);
        if (overCurrent === overTarget) overRate = 0;
        applyOverexpose(overCurrent);
      }
    },
    reset() {
      overCurrent = 0;
      overTarget = 0;
      overRate = 0;
      applyOverexpose(0);
      frozen = false;
      host.ice?.setFrozen(false);
      const persist = persistPass(host);
      if (persist) persist.decayScale = 1;
      warpOn = false;
      host.grid?.setWarp(ZERO_WARP);
      hijackText = '';
      host.hud?.hijack?.(null);
      personaWho = null;
      host.persona?.setWho(null, false);
      phonesOn = false;
      ownedPhones.stop();
      bargainId = null;
    },
    dispose() {
      api.reset();
      if (ownPhones) ownedPhones.dispose();
    },
  };
  return api;
}
