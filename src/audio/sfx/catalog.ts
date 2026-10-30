import type { SfxId, SfxOptions } from '../AudioEngine';
import { EXTRA_SFX_IDS, SFX_PALETTE } from './palette';
import { playNeuromancerSoften, playWintermuteHijack } from './recipes/ai';
import { playHullContact, playLockStep, playRekeyTelegraph, playShatter } from './recipes/contact';
import {
  flatlinePhaseAt,
  playFlatline,
  type FlatlineHandle,
  type FlatlinePhase,
} from './recipes/flatline';
import { createFlightHiss, playBoost, playGridTick, type FlightHiss } from './recipes/flight';
import { playJackIn, playJackOut } from './recipes/jack';
import { playJump, playJumpArrive } from './recipes/jump';
import { playKuang, playKuangSting } from './recipes/kuang';
import { playScan } from './recipes/scan';
import { playSimstimFlip } from './recipes/simstim';
import { playBurned, playTraceTick } from './recipes/trace';
import { playDeckError, playUiClick } from './recipes/ui';
import type { SfxWorld } from './synth';

export { EXTRA_SFX_IDS, SFX_PALETTE, type PaletteEntry, type PaletteId } from './palette';
export { FLATLINE_TIMING, flatlinePhaseAt, type FlatlinePhase } from './recipes/flatline';

export interface SfxCatalog {
  play(id: SfxId, opts?: SfxOptions): void;
  setFlight(speed: number): void;
  flightSpeed(): number;
  flatline: {
    start(opts?: SfxOptions): FlatlineHandle;
    stop(): void;
    /** Elapsed seconds since start, or -1 if idle. */
    elapsed(): number;
    phase(): FlatlinePhase;
    t0(): number;
  };
  dispose(): void;
}

export function createSfxCatalog(world: SfxWorld): SfxCatalog {
  const hiss: FlightHiss = createFlightHiss(world);
  let lockStep = 0;
  let flat: FlatlineHandle | null = null;

  const startFlatline = (opts?: SfxOptions): FlatlineHandle => {
    flat?.stop();
    flat = playFlatline(world, opts);
    return flat;
  };

  const catalog: SfxCatalog = {
    play(id, opts) {
      switch (id) {
        case 'jackIn':
          playJackIn(world, opts);
          return;
        case 'jackOut':
          playJackOut(world, opts);
          return;
        case 'boost':
          playBoost(world, hiss, opts);
          return;
        case 'gridTick':
          playGridTick(world, opts);
          return;
        case 'jump':
          playJump(world, opts);
          return;
        case 'jumpArrive':
          playJumpArrive(world, opts);
          return;
        case 'scan':
          playScan(world, opts);
          return;
        case 'hullContact':
          playHullContact(world, opts);
          return;
        case 'lockStep':
          playLockStep(world, lockStep++, opts);
          return;
        case 'rekeyTelegraph':
          playRekeyTelegraph(world, opts);
          return;
        case 'shatter':
          playShatter(world, opts);
          return;
        case 'traceTick':
          playTraceTick(world, opts);
          return;
        case 'burned':
          playBurned(world, opts);
          return;
        case 'flatline':
          startFlatline(opts);
          return;
        case 'simstimFlip':
          playSimstimFlip(world, opts);
          return;
        case 'kuang':
          playKuang(world, opts);
          return;
        case 'kuangSting':
          playKuangSting(world, opts);
          return;
        case 'wintermuteHijack':
          playWintermuteHijack(world, opts);
          return;
        case 'neuromancerSoften':
          playNeuromancerSoften(world, opts);
          return;
        case 'deckError':
          playDeckError(world, opts);
          return;
        case 'uiClick':
          playUiClick(world, opts);
          return;
        default: {
          const _never: never = id;
          return _never;
        }
      }
    },
    setFlight(speed) {
      hiss.setSpeed(speed);
    },
    flightSpeed: () => hiss.speed(),
    flatline: {
      start: startFlatline,
      stop() {
        flat?.stop();
        flat = null;
      },
      elapsed() {
        if (!flat) return -1;
        return world.ctx.currentTime - flat.t0;
      },
      phase() {
        const e = catalog.flatline.elapsed();
        return e < 0 ? 'idle' : flatlinePhaseAt(e);
      },
      t0: () => flat?.t0 ?? 0,
    },
    dispose() {
      flat?.stop();
      hiss.dispose();
    },
  };
  return catalog;
}

/** Exhaustiveness helper used by unit tests. */
export function paletteCoversEveryRecipe(): boolean {
  return SFX_PALETTE.length === 17;
}

export function extraSfxCount(): number {
  return EXTRA_SFX_IDS.length;
}
