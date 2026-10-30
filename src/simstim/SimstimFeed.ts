import type { SimstimTimeline } from '../content/simstim/types';
import type { EventBus } from '../core/events';
import type { InputFrame } from '../input/Input';
import type { Action } from '../narrative/schema';
import type { MissionRunner } from '../narrative/MissionRunner';
import type { Renderer } from '../render/Renderer';
import { chipClockAt } from './clock';
import { createGates, type GateDef, type GateSnapshot, type Gates } from './Gates';
import { createMollyTimeline, type MollyTimeline, type TimelineSample } from './MollyTimeline';
import { createPain, type Pain, type PainOverlay } from './Pain';
import { FLIP_BACK_LAG_S, idleFlipState, stepFlip, type FlipState } from './flip';

export interface SimstimFeedOptions {
  events: EventBus;
  mission?: MissionRunner;
  renderer?: Renderer;
  onActions?: (actions: Action[]) => void;
}

export interface SimstimDebug {
  flipped: boolean;
  peeking: boolean;
  meatTime: number;
  playbackTime: number;
  clock: string;
  waiting: boolean;
  exposure: number;
  pain: number;
  neural: number;
  lag: number;
  line: string;
  rekeysWhileFlipped: number;
}

export interface SimstimFeed {
  readonly timeline: MollyTimeline;
  readonly gates: Gates;
  readonly pain: Pain;
  readonly flipped: boolean;
  readonly peeking: boolean;
  readonly lag: number;
  /** Soft controls while lag > 0 (plan §3.7 flip-back). */
  readonly controlScale: number;
  readonly meatTime: number;
  readonly overlay: PainOverlay;
  readonly debug: SimstimDebug;
  readonly linkLive: boolean;
  load(def: SimstimTimeline, gates?: GateDef[]): void;
  /** Follow a mission's `simstim` block + meat clock. */
  attachMission(mission: MissionRunner): void;
  reset(): void;
  /** Force flip on/off (labs / tests). Plays the 0.3 s CRT transition. */
  setFlipped(on: boolean): void;
  handleInput(frame: InputFrame): void;
  /** ICE crack helper — posts `iceLayerCracked` so gates and the mission see it. */
  crack(iceNode: string): void;
  update(dt: number): void;
  sample(): TimelineSample;
  dispose(): void;
}

export function createSimstimFeed(opts: SimstimFeedOptions): SimstimFeed {
  const timeline = createMollyTimeline();
  const pain = createPain({ events: opts.events });
  const gates = createGates({
    events: opts.events,
    onActions: (actions) => opts.onActions?.(actions),
  });

  let flip: FlipState = idleFlipState();
  let meatTime = 0;
  let missionRef = opts.mission;
  let followMission = false;
  let rekeysWhileFlipped = 0;
  let lastLine = '';
  let disposed = false;

  const debug: SimstimDebug = {
    flipped: false,
    peeking: false,
    meatTime: 0,
    playbackTime: 0,
    clock: '00:00:00',
    waiting: false,
    exposure: 0,
    pain: 0,
    neural: 0,
    lag: 0,
    line: '',
    rekeysWhileFlipped: 0,
  };

  const unsubRekey = opts.events.on('iceRekey', () => {
    if (flip.flipped) rekeysWhileFlipped += 1;
  });

  const bindCrt = (on: boolean): void => {
    const renderer = opts.renderer;
    if (!renderer) return;
    const pass = renderer.chain.rasterCrt as {
      source?: unknown;
      playTransition?: (duration?: number) => void;
    };
    if (typeof pass.playTransition !== 'function') return;
    if (on) {
      pass.source = renderer.targets.simstim.texture;
      renderer.postMode = 'simstim';
      pass.playTransition(0.3);
    } else {
      if (pass.source === renderer.targets.simstim.texture) pass.source = null;
      renderer.postMode = 'matrix';
    }
    renderer.pipEnabled = !on && timeline.def !== null;
  };

  const applyFlip = (next: FlipState): void => {
    const was = flip.flipped;
    if (was && !next.flipped) next.lag = FLIP_BACK_LAG_S;
    flip = next;
    if (was === next.flipped) return;
    if (next.flipped) {
      opts.events.post({ type: 'simstimFlip', on: true });
      bindCrt(true);
    } else {
      opts.events.post({ type: 'simstimFlip', on: false });
      pain.flipBack();
      bindCrt(false);
    }
  };

  const refreshDebug = (): void => {
    let exposure = 0;
    for (const g of gates.snapshots) if (g.exposure > exposure) exposure = g.exposure;
    debug.flipped = flip.flipped;
    debug.peeking = flip.peeking;
    debug.meatTime = meatTime;
    debug.playbackTime = timeline.playbackTime;
    debug.clock = chipClockAt(timeline.def?.clockStart ?? '00:00:00', meatTime);
    debug.waiting = gates.waiting;
    debug.exposure = exposure;
    debug.pain = pain.amount;
    debug.neural = pain.neural;
    debug.lag = flip.lag;
    debug.line = lastLine;
    debug.rekeysWhileFlipped = rekeysWhileFlipped;
  };

  const loadGatesFromMission = (mission: MissionRunner): void => {
    const block = mission.def?.simstim;
    if (!block) return;
    const list: GateDef[] = block.gates.map((g) => ({
      id: g.id,
      iceNode: g.iceNode,
      tMeat: g.tMeat,
      early: g.early,
      late: g.late,
      onEarly: g.onEarly,
      onLate: g.onLate,
    }));
    gates.load(list, timeline.def?.branches);
  };

  const api: SimstimFeed = {
    timeline,
    gates,
    pain,
    get flipped() {
      return flip.flipped;
    },
    get peeking() {
      return flip.peeking;
    },
    get lag() {
      return flip.lag;
    },
    get controlScale() {
      if (flip.lag <= 0) return 1;
      return 0.35 + 0.65 * (1 - flip.lag / FLIP_BACK_LAG_S);
    },
    get meatTime() {
      return meatTime;
    },
    get overlay() {
      return pain.overlay;
    },
    debug,
    get linkLive() {
      return timeline.def !== null;
    },
    load(def, gateList) {
      timeline.load(def);
      gates.load(gateList ?? [], def.branches);
      meatTime = 0;
      rekeysWhileFlipped = 0;
      lastLine = '';
      flip = idleFlipState();
      pain.reset();
      if (opts.renderer) opts.renderer.pipEnabled = true;
      refreshDebug();
    },
    attachMission(mission) {
      followMission = true;
      missionRef = mission;
      loadGatesFromMission(mission);
    },
    reset() {
      timeline.reset();
      gates.reset();
      pain.reset();
      meatTime = 0;
      rekeysWhileFlipped = 0;
      lastLine = '';
      flip = idleFlipState();
      refreshDebug();
    },
    setFlipped(on) {
      if (on === flip.flipped) return;
      applyFlip({ ...flip, flipped: on, peeking: false, pressFromIdle: false });
    },
    handleInput(frame) {
      const next = stepFlip(
        flip,
        {
          pressed: frame.pressed('simstim'),
          released: frame.released('simstim'),
          held: frame.held('simstim'),
        },
        frame.dt,
      );
      applyFlip(next);
    },
    crack(iceNode) {
      opts.events.post({ type: 'iceLayerCracked', iceId: iceNode, layer: 0 });
      gates.crack(iceNode);
    },
    update(dt) {
      if (disposed) return;
      if (followMission && missionRef && missionRef.status === 'running') {
        meatTime = missionRef.meatTime;
      } else {
        meatTime += Math.max(0, dt);
      }
      gates.update(meatTime, dt);
      timeline.update(dt, meatTime, gates.waitPlayback);
      pain.update(dt);
      flip.lag = Math.max(0, flip.lag - Math.max(0, dt));
      for (const line of timeline.firedLines) lastLine = `${line.who}: ${line.text}`;
      if (opts.renderer) {
        opts.renderer.pipEnabled = !flip.flipped && timeline.def !== null;
      }
      refreshDebug();
    },
    sample() {
      return timeline.sample();
    },
    dispose() {
      disposed = true;
      unsubRekey();
      gates.dispose();
      pain.dispose();
      if (opts.renderer) {
        opts.renderer.pipEnabled = false;
        bindCrt(false);
      }
    },
  };

  return api;
}

export function gateExposure(snapshots: readonly GateSnapshot[]): number {
  let e = 0;
  for (const g of snapshots) if (g.exposure > e) e = g.exposure;
  return e;
}
