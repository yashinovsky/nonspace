import { LayerSim, type LayerStats, type LayerStatus } from '../breach/LayerSim';
import { type Difficulty, type IcePreset, applyDifficulty } from '../breach/presets';
import { type BotProfile, HumanProxy } from './HumanProxy';

export interface TryResult {
  seed: number;
  status: LayerStatus | 'timeout';
  /** seconds from engage to crack / fail */
  time: number;
  grip: boolean;
  trace: number;
  neural: number;
  stats: LayerStats;
}

export interface TryOptions {
  dt?: number;
  maxTime?: number;
  telegraphPreview?: boolean;
  purist?: boolean;
}

/** One scripted breach attempt against a single layer, at a fixed 120 Hz step. */
export function runTry(ice: IcePreset, diff: Difficulty, profile: BotProfile, seed: number, opts: TryOptions = {}): TryResult {
  const dt = opts.dt ?? 1 / 120;
  const maxTime = opts.maxTime ?? 180;
  const def = applyDifficulty(ice.layer, diff);
  const sim = new LayerSim(def, seed);
  const bot = new HumanProxy({ ...profile, useTelegraph: opts.telegraphPreview ?? profile.useTelegraph }, def.ratios, seed ^ 0x5bd1e995);
  bot.purist = opts.purist ?? false;
  let gripped = false;
  while (sim.state.status === 'engaged' && sim.state.t < maxTime) {
    bot.step(dt, sim);
    for (const e of sim.step(dt, bot.R, bot.Phi)) if (e.type === 'grip') gripped = true;
  }
  const s = sim.state;
  return {
    seed,
    status: s.status === 'engaged' ? 'timeout' : s.status,
    time: s.t,
    grip: gripped,
    trace: s.trace,
    neural: s.neural,
    stats: { ...s.stats },
  };
}
