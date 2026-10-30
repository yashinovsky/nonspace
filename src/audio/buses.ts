import { dbToLinear } from './dsp/gain';

/** Mix buses (plan §7.6): master ← [music, sfx, ui, voice, ambience] + duck + limiter. */
export const BUS_IDS = ['music', 'sfx', 'ui', 'voice', 'ambience'] as const;
export type BusId = (typeof BUS_IDS)[number];

export interface BusChannel {
  readonly gain: GainNode;
  readonly duck: GainNode;
  /** Connect sources here (the user-gain node). */
  readonly input: GainNode;
}

export interface AudioBusGraph {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly masterDuck: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly buses: Record<BusId, BusChannel>;
  input(id: BusId): AudioNode;
  setBusGain(id: BusId | 'master', linear: number, when?: number): void;
  duck(target: 'all' | 'music', db: number, seconds: number): void;
  getDuckGain(target: 'all' | 'music'): number;
  dispose(): void;
}

const DUCK_ATTACK = 0.05;
const DUCK_RELEASE = 0.2;

function automateDuck(param: AudioParam, linear: number, seconds: number, t: number): void {
  const hold = Math.max(0, seconds);
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(linear, t + DUCK_ATTACK);
  param.setValueAtTime(linear, t + DUCK_ATTACK + hold);
  param.linearRampToValueAtTime(1, t + DUCK_ATTACK + hold + DUCK_RELEASE);
}

/**
 * Build the mix graph and connect it to ctx.destination. The limiter is a
 * brickwall-ish compressor on master (plan §7.6).
 */
export function createBusGraph(ctx: AudioContext): AudioBusGraph {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0.5;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const masterDuck = ctx.createGain();
  masterDuck.gain.value = 1;
  masterDuck.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const buses = {} as Record<BusId, BusChannel>;
  for (const id of BUS_IDS) {
    const gain = ctx.createGain();
    const duck = ctx.createGain();
    gain.gain.value = 1;
    duck.gain.value = 1;
    gain.connect(duck);
    duck.connect(masterDuck);
    buses[id] = { gain, duck, input: gain };
  }

  const duckParam = (target: 'all' | 'music'): AudioParam =>
    target === 'music' ? buses.music.duck.gain : masterDuck.gain;

  const graph: AudioBusGraph = {
    context: ctx,
    master,
    masterDuck,
    limiter,
    buses,
    input(id) {
      return buses[id].input;
    },
    setBusGain(id, linear, when) {
      const t = when ?? ctx.currentTime;
      const param = id === 'master' ? master.gain : buses[id].gain.gain;
      param.setTargetAtTime(Math.max(0, linear), t, 0.02);
    },
    duck(target, db, seconds) {
      automateDuck(duckParam(target), dbToLinear(db), seconds, ctx.currentTime);
    },
    getDuckGain(target) {
      return duckParam(target).value;
    },
    dispose() {
      for (const id of BUS_IDS) {
        buses[id].gain.disconnect();
        buses[id].duck.disconnect();
      }
      masterDuck.disconnect();
      master.disconnect();
      limiter.disconnect();
    },
  };
  return graph;
}

export { dbToLinear, linearToDb } from './dsp/gain';
