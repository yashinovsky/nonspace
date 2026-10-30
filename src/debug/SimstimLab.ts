import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import { createSimstimMode } from '../app/modes/Simstim';
import type { Mode, ModeContext, ModeStack } from '../app/ModeStack';
import { LAB_GATE, labSimstimTimeline } from '../content/simstim/labTimeline';
import { SENSE_NET_GATES, senseNetTimeline } from '../content/simstim/senseNet';
import type { SimstimTimeline } from '../content/simstim/types';
import type { InputFrame } from '../input/Input';
import type { MissionRunner } from '../narrative/MissionRunner';
import { createSimstimRenderer } from '../render/simstim/SimstimRenderer';
import { zoneTotal, type ZoneStats } from '../render/simstim/kit';
import type { Renderer } from '../render/Renderer';
import type { GateDef } from '../simstim/Gates';
import type { SimstimFeed } from '../simstim/SimstimFeed';

export type SimstimLabScene = 'lab' | 'sensenet';

export interface SimstimLabOptions {
  scene?: string | null;
  mission?: MissionRunner;
  /** Fast-forward meat time (seconds) before the first frame. */
  seek?: number;
}

export interface SimstimLab {
  update(dt: number): void;
  dispose(): void;
}

export interface SimstimLabHandle {
  scene: SimstimLabScene;
  stats: ZoneStats;
  panic: boolean;
  seek(t: number): void;
}

declare global {
  interface Window {
    __nonspaceSenseNet?: SimstimLabHandle;
  }
}

const REKEY_EVERY = 1.6;

export function parseSimstimScene(raw: string | null | undefined): SimstimLabScene {
  if (raw === 'lab' || raw === 'lab:lobby') return 'lab';
  return 'sensenet';
}

/**
 * `?lab=simstim` — Sense/Net walk (M6.2) through RasterCrtPass, plus the
 * M6.1 feed FSM. `&scene=lab` keeps the original one-gate lobby. `?mission=m2`
 * loads the same Sense/Net timeline against the mock runner's meat clock.
 */
export function installSimstimLab(
  renderer: Renderer,
  feed: SimstimFeed,
  modes: ModeStack,
  opts: SimstimLabOptions = {},
): SimstimLab {
  const scene = parseSimstimScene(opts.scene);
  const view = createSimstimRenderer(renderer);
  const pack = scenePack(scene);
  feed.load(pack.timeline, pack.gates);
  view.load(pack.timeline);
  if (opts.mission) feed.attachMission(opts.mission);

  const simstimMode = createSimstimMode(feed, view);
  let rekeyAcc = 0;
  let ctxRef: ModeContext | null = null;
  const iceNodes = pack.gates.map((g) => g.iceNode);

  const cubeGeom = new BoxGeometry(0.6, 0.6, 0.6);
  const cubeMat = new MeshBasicMaterial({ color: 0x14c77a, toneMapped: false });
  const marker = new Mesh(cubeGeom, cubeMat);
  marker.position.set(2, 0.4, -1);
  renderer.scenes.matrix.add(marker);

  const matrix: Mode = {
    id: 'matrix',
    simulatesWhenCovered: true,
    enter(ctx) {
      ctxRef = ctx;
    },
    exit() {
      ctxRef = null;
    },
    update(dt) {
      rekeyAcc += dt;
      if (rekeyAcc >= REKEY_EVERY) {
        rekeyAcc -= REKEY_EVERY;
        ctxRef?.events.post({ type: 'iceRekey', iceId: iceNodes[0] ?? 'sense-net-lobby' });
      }
      marker.rotation.y += dt * 0.7;
    },
    render() {},
    handleInput(frame: InputFrame) {
      const was = feed.flipped;
      feed.handleInput(frame);
      if (!was && feed.flipped) ctxRef?.modes.push(simstimMode);
      if (frame.pressed('scan')) crackOpen(feed, pack.gates);
      if (frame.pressed('soft1')) feed.pain.hurt(0.85);
    },
  };

  modes.push(matrix);

  const hint = document.createElement('div');
  hint.dataset.testid = 'simstim-lab';
  hint.style.cssText =
    'position:absolute;left:8px;top:8px;z-index:2;font:12px monospace;color:#ccc';
  renderer.canvas.parentElement?.appendChild(hint);

  const handle: SimstimLabHandle = {
    scene,
    stats: view.stats,
    panic: false,
    seek(t) {
      seekMeat(feed, t, opts.mission);
      const sample = feed.sample();
      view.apply(sample, feed.overlay, feed.meatTime);
      handle.panic = sample.figures.some((f) => f.pose === 'run');
      const root = renderer.canvas.parentElement;
      if (root) root.dataset.panic = handle.panic ? '1' : '0';
    },
  };
  window.__nonspaceSenseNet = handle;

  if (opts.seek && opts.seek > 0) handle.seek(opts.seek);

  const syncHint = (): void => {
    const d = feed.debug;
    const gate = feed.gates.snapshots.map((s) => `${s.id}:${s.state}`).join(',');
    hint.dataset.clock = d.clock;
    hint.dataset.scene = scene;
    hint.dataset.gate = feed.gates.get(pack.gates[0]?.id ?? '')?.state ?? 'idle';
    hint.dataset.gates = gate;
    hint.dataset.rekeys = String(d.rekeysWhileFlipped);
    hint.dataset.panic = handle.panic ? '1' : '0';
    hint.dataset.line = d.line;
    hint.textContent = `${scene} ${d.clock} ${gate || 'idle'} rk${d.rekeysWhileFlipped}`;
  };

  return {
    update() {
      const sample = feed.sample();
      view.apply(sample, feed.overlay, feed.meatTime);
      handle.stats = view.stats;
      handle.panic = sample.figures.some((f) => f.pose === 'run');
      const root = renderer.canvas.parentElement;
      if (root) {
        root.dataset.flipped = feed.flipped ? '1' : '0';
        root.dataset.clock = feed.debug.clock;
        root.dataset.scene = scene;
        root.dataset.gate = feed.gates.get(pack.gates[0]?.id ?? '')?.state ?? 'idle';
        root.dataset.gates = feed.gates.snapshots.map((s) => s.state).join(',');
        root.dataset.rekeys = String(feed.debug.rekeysWhileFlipped);
        root.dataset.meat = feed.debug.meatTime.toFixed(2);
        root.dataset.exposure = String(
          feed.gates.snapshots.reduce((n, s) => Math.max(n, s.exposure), 0).toFixed(3),
        );
        root.dataset.pain = feed.debug.pain.toFixed(2);
        root.dataset.waiting = feed.debug.waiting ? '1' : '0';
        root.dataset.panic = handle.panic ? '1' : '0';
        root.dataset.tris = String(zoneTotal(view.stats));
        root.dataset.line = feed.debug.line;
      }
      syncHint();
    },
    dispose() {
      view.dispose();
      renderer.scenes.matrix.remove(marker);
      cubeGeom.dispose();
      cubeMat.dispose();
      hint.remove();
      if (window.__nonspaceSenseNet === handle) delete window.__nonspaceSenseNet;
    },
  };
}

function scenePack(scene: SimstimLabScene): { timeline: SimstimTimeline; gates: GateDef[] } {
  if (scene === 'lab') return { timeline: labSimstimTimeline(), gates: [LAB_GATE] };
  return { timeline: senseNetTimeline(), gates: SENSE_NET_GATES };
}

function crackOpen(feed: SimstimFeed, gates: GateDef[]): void {
  const snaps = feed.gates.snapshots;
  const open = snaps.find((s) => s.state === 'open' || s.state === 'late');
  const idle = snaps.find((s) => s.state === 'idle');
  const id = open?.iceNode ?? idle?.iceNode ?? gates[0]?.iceNode;
  if (id) feed.crack(id);
}

function seekMeat(feed: SimstimFeed, t: number, mission?: MissionRunner): void {
  const step = 1 / 60;
  let guard = 0;
  while (feed.meatTime < t && guard++ < 8_000) {
    mission?.update(step);
    feed.update(step);
  }
}
