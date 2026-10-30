import { createInterludeMode } from '../app/modes/Interlude';
import { createBeachMode, type BeachMode } from '../app/modes/Beach';
import type { ModeStack } from '../app/ModeStack';
import type { EventBus } from '../core/events';
import type { SaveStore } from '../core/save';
import type { SettingsStore } from '../core/settings';
import type { InputService } from '../input/Input';
import { createInterlude, type Interlude } from '../meat/Interlude';
import type { InkStory } from '../narrative/InkRuntime';
import type { MissionEffects, MissionRunner } from '../narrative/MissionRunner';
import { loadCampaignMission } from '../content/missions/load';
import { M6_BASS, M6_HEAR_RADIUS } from '../content/missions/m6';
import type { Renderer } from '../render/Renderer';
import { EXIT, LINDA } from '../render/beach/world';
import type { BeachSim } from '../render/beach/sim';
import m6Ink from '../content/ink/m6.json';

/** Who asked for the beach. `m5` skips the teletext brief (forced flatline). */
export type EnterBeachSource = 'm5' | 'm6' | 'force';

export interface BeachHandle {
  missionId: string;
  status: string;
  mode: string;
  phase: string;
  knot: string | null;
  ended: boolean;
  won: boolean;
  ending: 'leave' | 'stay' | null;
  reveal: number;
  stillness: number;
  bassDistance: number;
  lindaDistance: number;
  fpsHint: number;
  halfRes: { w: number; h: number };
  beach: BeachSim | undefined;
  skipBrief(): void;
  choose(n: number): boolean;
  followBass(): { from: number; to: number; left: boolean };
  walkOut(): void;
  stay(): void;
  sitThroughSunset(): void;
  lookDown(): void;
  skipOverlay(): void;
  advance(dt: number): void;
  paint(): void;
}

export interface BeachMission {
  readonly handle: BeachHandle;
  readonly effects: MissionEffects;
  readonly beach: BeachSim | undefined;
  update(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export interface EnterBeachOptions {
  root: HTMLElement;
  renderer: Renderer;
  events: EventBus;
  save: SaveStore;
  settings: SettingsStore;
  input: InputService;
  modes: ModeStack;
  mission: MissionRunner;
  effectsSlot: { current: MissionEffects | null };
  /** `m5` / `force` = wake on the sand (M5 flatline). `m6` shows the brief. */
  source?: EnterBeachSource;
  checkpoint?: string;
}

const running = new WeakMap<HTMLElement, BeachMission>();
const pending = new WeakMap<HTMLElement, Promise<BeachMission>>();

function skipBriefFor(source: EnterBeachSource, checkpoint?: string): boolean {
  if (source !== 'm6') return true;
  return checkpoint === 'shore' || checkpoint === 'stay' || checkpoint === 'leave';
}

/**
 * Enter walking-only M6. Idempotent per `#app` root so M5 `forceMode('beach')`
 * and `?mission=m6` share one instance. Walking mode mounts before the first
 * `await` so M5's scripted `skipOverlay` sees `mode === 'beach'` in the same tick.
 */
export function enterBeach(opts: EnterBeachOptions): Promise<BeachMission> {
  const existing = running.get(opts.root);
  if (existing) return Promise.resolve(existing);
  const inflight = pending.get(opts.root);
  if (inflight) return inflight;
  const work = enterBeachNow(opts);
  pending.set(opts.root, work);
  void work.finally(() => pending.delete(opts.root));
  return work;
}

async function enterBeachNow(opts: EnterBeachOptions): Promise<BeachMission> {
  const { root, renderer, events, modes, mission } = opts;
  const source: EnterBeachSource = opts.source ?? 'm6';

  renderer.pipEnabled = false;
  renderer.scenes.hud.visible = false;
  renderer.vectorLoad = 0;

  let beachMode: BeachMode | null = null;
  let interlude: Interlude | null = null;
  let disposed = false;
  let fpsHint = 60;
  let lastMs = 0;

  const effects: MissionEffects = {
    music(state) {
      if (state === 'beach' || state === 'silent') {
        const audio = (modes.ctx as { audio?: { music: { setState(s: string): void } } }).audio;
        audio?.music.setState(state);
      }
    },
    say(_who, _line) {
      /* beach subtitles are diegetic; no HUD */
    },
  };

  const simOf = (): BeachSim => {
    if (!beachMode) throw new Error('beach mode not mounted');
    return beachMode.sim;
  };

  const overlayPaint = (): boolean => modes.top?.id === 'interlude';

  const pushBeach = (): void => {
    if (modes.has('beach') && beachMode) return;
    beachMode = createBeachMode();
    modes.reset(beachMode);
    renderer.postMode = 'beach';
    renderer.scenes.hud.visible = false;
  };

  const dropOverlay = (): void => {
    while (modes.top && (modes.top.id === 'interlude' || modes.top.id === 'boot')) {
      modes.pop();
    }
  };

  const beginWalk = (checkpoint?: string): void => {
    dropOverlay();
    interlude?.dispose();
    interlude = null;
    pushBeach();
    opts.effectsSlot.current = effects;
    if (mission.status === 'idle') mission.start(checkpoint ? { checkpoint } : undefined);
    const sim = simOf();
    mission.setLandmark(M6_BASS, EXIT.x, 0, EXIT.z);
    mission.setPlayerPosition(sim.walk.pose.x, sim.walk.pose.y, sim.walk.pose.z);
    events.flush();
    mission.update(0);
    root.dataset.mission = 'm6';
    root.dataset.phase = sim.phase;
  };

  const showBrief = (): void => {
    interlude?.dispose();
    interlude = createInterlude({
      story: m6Ink as InkStory,
      onChange(info) {
        root.dataset.knot = info.knot;
        if (info.ended && !beachMode) beginWalk(opts.checkpoint);
      },
    });
    interlude.ink.goto('brief');
    modes.reset(createInterludeMode(interlude));
    root.dataset.knot = interlude.info.knot;
    root.dataset.mission = 'm6';
  };

  const pickWalk = (): boolean => {
    if (!interlude) return false;
    const walk = interlude.ink.state.choices.find((c) => /WALK/i.test(c.text));
    if (walk) return interlude.choose(walk.index);
    return interlude.choose(1);
  };

  const applyStay = (): void => {
    const sim = simOf();
    sim.forceStay();
    modes.update(0);
    events.flush();
    mission.update(0);
  };

  const applyLeave = (): void => {
    const sim = simOf();
    sim.setPose(EXIT.x, EXIT.z);
    modes.update(1 / 60);
    events.flush();
    mission.update(0);
  };

  const handle: BeachHandle = {
    get missionId() {
      return mission.def?.id ?? 'm6';
    },
    get status() {
      return mission.status;
    },
    get mode() {
      return modes.top?.id ?? '';
    },
    get phase() {
      return beachMode?.sim.phase ?? 'walk';
    },
    get knot() {
      return interlude?.info.knot ?? null;
    },
    get ended() {
      return mission.status === 'won' || mission.status === 'failed';
    },
    get won() {
      return mission.status === 'won';
    },
    get ending() {
      if (mission.flag('endingB') || beachMode?.sim.phase === 'endingB') return 'stay';
      if (mission.flag('beachLeft') || beachMode?.sim.phase === 'left') return 'leave';
      return null;
    },
    get reveal() {
      return beachMode?.sim.reveal ?? 0;
    },
    get stillness() {
      return beachMode?.sim.stillness ?? 0;
    },
    get bassDistance() {
      return beachMode?.sim.debug.bassDistance ?? 0;
    },
    get lindaDistance() {
      return beachMode?.sim.debug.lindaDistance ?? 0;
    },
    get fpsHint() {
      return fpsHint;
    },
    get halfRes() {
      return {
        w: Math.max(1, Math.ceil(renderer.internalWidth / 2)),
        h: Math.max(1, Math.ceil(renderer.internalHeight / 2)),
      };
    },
    get beach() {
      return beachMode?.sim;
    },
    skipBrief() {
      if (interlude && modes.has('interlude')) {
        if (!pickWalk()) interlude.choose(1);
      }
      if (!beachMode) beginWalk(opts.checkpoint);
    },
    choose(n) {
      return interlude?.choose(n) ?? false;
    },
    followBass() {
      if (!beachMode) beginWalk();
      const sim = simOf();
      const from = sim.debug.bassDistance;
      sim.faceBass();
      sim.input.thrust = 1;
      sim.input.strafe = 0;
      sim.input.locked = true;
      let guard = 960;
      while (sim.phase === 'walk' && guard-- > 0) {
        modes.update(1 / 60);
        mission.setPlayerPosition(sim.walk.pose.x, sim.walk.pose.y, sim.walk.pose.z);
        events.flush();
        mission.update(1 / 60);
        if (sim.debug.bassDistance < 0.5) break;
      }
      if (sim.phase === 'walk' && sim.debug.bassDistance <= M6_HEAR_RADIUS) {
        sim.setPose(EXIT.x, EXIT.z);
        modes.update(1 / 60);
        events.flush();
        mission.update(0);
      }
      return { from, to: sim.debug.bassDistance, left: sim.phase === 'left' };
    },
    walkOut() {
      if (!beachMode) beginWalk();
      applyLeave();
    },
    stay() {
      if (!beachMode) beginWalk();
      applyStay();
    },
    sitThroughSunset() {
      if (!beachMode) beginWalk();
      const sim = simOf();
      sim.setPose(LINDA.x + 0.35, LINDA.z + 0.4);
      sim.sitPressed = true;
      modes.update(1 / 60);
      let guard = 80;
      while (sim.phase === 'sitting' && guard-- > 0) {
        modes.update(0.5);
      }
      if (sim.phase !== 'endingB') sim.forceStay();
      modes.update(0);
      events.flush();
      mission.update(0);
    },
    lookDown() {
      if (!beachMode) beginWalk();
      const sim = simOf();
      sim.walk.pose.pitch = -1.2;
      sim.walk.prev.pitch = -1.2;
      sim.stillness = 1;
      sim.input.thrust = 0;
      for (let i = 0; i < 90; i++) modes.update(1 / 60);
    },
    skipOverlay() {
      if (interlude && modes.has('interlude')) {
        if (!pickWalk()) interlude.choose(1);
      }
    },
    advance(dt) {
      const top = modes.top?.id;
      if (top === 'beach' || top === 'interlude') modes.update(dt);
      if (beachMode) {
        const sim = beachMode.sim;
        mission.setPlayerPosition(sim.walk.pose.x, sim.walk.pose.y, sim.walk.pose.z);
        root.dataset.phase = sim.phase;
        if (sim.phase === 'endingB') root.dataset.ending = 'B';
        if (sim.phase === 'left') root.dataset.ending = 'leave';
      }
      events.flush();
      mission.update(dt);
    },
    paint() {
      if (overlayPaint()) {
        interlude?.update(0);
        modes.render(1);
        return;
      }
      if (beachMode) beachMode.render(1);
      else modes.render(1);
    },
  };

  if (skipBriefFor(source, opts.checkpoint)) {
    pushBeach();
    renderer.postMode = 'beach';
    root.dataset.mission = 'm6';
    root.dataset.source = source;
  }

  const def = await loadCampaignMission('m6');
  if (!def) throw new Error('m6 mission missing');

  opts.effectsSlot.current = effects;
  mission.load(def);

  if (skipBriefFor(source, opts.checkpoint)) {
    beginWalk(source === 'm6' ? opts.checkpoint : undefined);
  } else showBrief();

  if (opts.checkpoint === 'stay' && beachMode) applyStay();
  if (opts.checkpoint === 'leave' && beachMode) applyLeave();

  root.dataset.mission = 'm6';
  root.dataset.source = source;
  // M5 e2e keeps the Kuang handle on window after intercept.
  if (source !== 'm5') {
    (window as unknown as { __nonspaceMission?: BeachHandle }).__nonspaceMission = handle;
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  lastMs = t0;

  const run: BeachMission = {
    handle,
    effects,
    get beach() {
      return beachMode?.sim;
    },
    update(dt) {
      if (disposed) return;
      if (beachMode) {
        const sim = beachMode.sim;
        mission.setPlayerPosition(sim.walk.pose.x, sim.walk.pose.y, sim.walk.pose.z);
        root.dataset.phase = sim.phase;
        if (sim.phase === 'endingB') root.dataset.ending = 'B';
        if (sim.phase === 'left') root.dataset.ending = 'leave';
      }
      const now = typeof performance !== 'undefined' ? performance.now() : lastMs + dt * 1000;
      if (dt > 0) {
        const inst = 1 / dt;
        fpsHint = fpsHint * 0.85 + inst * 0.15;
      }
      lastMs = now;
    },
    render(_alpha) {
      if (disposed) return;
      renderer.scenes.hud.visible = false;
    },
    dispose() {
      disposed = true;
      if (source !== 'm5') {
        const w = window as unknown as { __nonspaceMission?: BeachHandle };
        if (w.__nonspaceMission === handle) delete w.__nonspaceMission;
      }
      interlude?.dispose();
      interlude = null;
      beachMode = null;
      running.delete(root);
    },
  };

  running.set(root, run);
  return run;
}

/** Alias so campaign loaders match `startTuringMission` naming. */
export const startBeachMission = enterBeach;
