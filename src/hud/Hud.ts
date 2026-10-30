import type { EventBus } from '../core/events';
import type { Palette } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import { createBargraph } from './Bargraph';
import { createEegTrace, eegVariance } from './EegTrace';
import { createPip } from './Pip';
import { createRadar, type RadarBlip } from './Radar';
import { createReticle, type ReticleLock } from './Reticle';
import { createTerminal, type TerminalPrintOpts } from './Terminal';
import { createVfdStrip, type SoftSlot } from './VfdStrip';

/** HUD geometry sits in front of the ortho camera (plan §8.3 pixel units). */
export const HUD_Z = -1;

export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudPt {
  x: number;
  y: number;
}

export interface HudLayout {
  width: number;
  height: number;
  aspect: number;
  margin: number;
  terminal: HudRect;
  radar: HudRect;
  pip: HudRect;
  strip: HudRect;
  eeg: HudRect;
  eegLabel: HudPt;
  neural: HudPt;
  coords: HudPt;
  mode: HudPt;
  speed: HudPt;
  traceLabel: HudPt;
  trace: HudRect;
  softs: HudPt;
  reticle: HudPt;
  reticleArm: number;
  periscope: { tl: HudPt; tr: HudPt; bl: HudPt; br: HudPt; arm: number };
  vfdSize: number;
  terminalCell: number;
}

export type HudRunMode = 'TRANSIT' | 'APPROACH' | 'BREACH' | 'CORE' | 'GRIP';

export interface HudState {
  neural: number;
  trace: number;
  flatline: boolean;
  scars: number;
  mode: string;
  speed: number;
  coords: string;
  softs: SoftSlot[];
  blips: RadarBlip[];
  gripRemaining: number | null;
  lock: ReticleLock | null;
}

const DEFAULT_SOFTS: SoftSlot[] = [
  { label: 'PROBE', cooldown: 0 },
  { label: 'CLAMP', cooldown: 0 },
  { label: 'DAMPER', cooldown: 0.35 },
  { label: '--', cooldown: 0 },
];

const DEFAULT_BLIPS: RadarBlip[] = [
  { angle: 0.4, radius: 0.62, kind: 'target' },
  { angle: 2.2, radius: 0.38, kind: 'ice' },
  { angle: 4.1, radius: 0.78, kind: 'watcher' },
  { angle: 5.5, radius: 0.5, kind: 'kuang' },
];

/**
 * Anchor-based overlay. 16:9 is the authored shape; 21:9 gains side margin
 * (radar/PIP stay right); 4:3 shrinks radar/PIP so the terminal still fits.
 */
export function layoutHud(width: number, height: number): HudLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const s = Math.min(w, h);
  const m = Math.max(10, Math.round(s * 0.018));
  const pipW = Math.max(88, Math.round(s * 0.135));
  const pipH = Math.round((pipW * 240) / 320);
  const radarR = Math.max(48, Math.round(s * 0.088));
  const radarSize = radarR * 2;
  const stripH = Math.max(70, Math.round(h * 0.125));
  const vfdSize = Math.max(11, Math.min(18, Math.round(s * 0.014)));

  const pip: HudRect = { x: w - m - pipW, y: h - m - pipH, w: pipW, h: pipH };
  let radarX = pip.x - m * 0.8 - radarSize;
  if (radarX < m + 80) radarX = Math.max(m, pip.x - radarSize - 6);
  const radar: HudRect = {
    x: radarX,
    y: h - m - radarSize,
    w: radarSize,
    h: radarSize,
  };
  const termH = Math.max(28, Math.round(h * 0.055));
  const termW = Math.max(120, radar.x - m * 2);
  const terminal: HudRect = { x: m, y: h - m - termH, w: termW, h: termH };
  const strip: HudRect = { x: m, y: m, w: w - m * 2, h: stripH };

  const col0 = strip.x;
  const col1 = strip.x + strip.w * 0.26;
  const col2 = strip.x + strip.w * 0.58;
  const col3 = strip.x + strip.w * 0.78;
  const topY = strip.y + strip.h - vfdSize - 6;
  const botY = strip.y + 8;
  const eeg: HudRect = {
    x: col0 + vfdSize * 4,
    y: strip.y + strip.h * 0.42,
    w: Math.max(60, col1 - col0 - vfdSize * 5),
    h: strip.h * 0.42,
  };

  const arm = Math.max(14, Math.round(s * 0.028));
  const insetX = Math.max(m * 2, w * 0.16);
  const insetY = Math.max(strip.h + m * 2, h * 0.22);

  return {
    width: w,
    height: h,
    aspect: w / h,
    margin: m,
    terminal,
    radar,
    pip,
    strip,
    eeg,
    eegLabel: { x: col0, y: topY },
    neural: { x: col0, y: botY },
    coords: { x: col1, y: topY },
    mode: { x: col1, y: botY },
    speed: { x: col2, y: topY },
    traceLabel: { x: col2, y: botY },
    trace: {
      x: col2 + vfdSize * 6,
      y: botY,
      w: Math.max(70, col3 - col2 - vfdSize * 6.5),
      h: vfdSize * 0.95,
    },
    softs: { x: col3, y: botY },
    reticle: { x: w * 0.5, y: h * 0.5 },
    reticleArm: arm,
    periscope: {
      tl: { x: insetX, y: h - insetY },
      tr: { x: w - insetX, y: h - insetY },
      bl: { x: insetX, y: insetY },
      br: { x: w - insetX, y: insetY },
      arm: Math.max(16, Math.round(s * 0.032)),
    },
    vfdSize,
    terminalCell: Math.max(10, Math.round(s * 0.013)),
  };
}

export interface Hud {
  readonly layout: HudLayout;
  readonly state: HudState;
  readonly terminalVisible: string;
  readonly terminalPending: number;
  readonly eegVariance: number;
  readonly pipLink: boolean;
  resize(width: number, height: number): void;
  setNeural(value: number): void;
  setTrace(value: number): void;
  setFlatline(on: boolean): void;
  setScars(n: number): void;
  setMode(mode: string): void;
  setSpeed(speed: number): void;
  setCoords(coords: string): void;
  setPain(amount: number): void;
  setPipLink(on: boolean): void;
  setGrip(remaining: number | null): void;
  setLock(lock: ReticleLock | null): void;
  print(text: string, opts?: TerminalPrintOpts): void;
  clearTerminal(): void;
  update(dt: number): void;
  dispose(): void;
}

export interface CreateHudOptions {
  renderer: Renderer;
  events?: EventBus;
  palette?: Palette;
  reduceFlashing?: () => boolean;
}

function writeChrome(batch: BeamBatchGpu, layout: HudLayout): void {
  const { periscope: p } = layout;
  const s = layout.strip;
  const n = 12;
  const set = createLineSet(n, { width: true, flags: true });
  const arm = p.arm;
  const segs: Array<[number, number, number, number]> = [
    [p.tl.x, p.tl.y, p.tl.x + arm, p.tl.y],
    [p.tl.x, p.tl.y, p.tl.x, p.tl.y - arm],
    [p.tr.x, p.tr.y, p.tr.x - arm, p.tr.y],
    [p.tr.x, p.tr.y, p.tr.x, p.tr.y - arm],
    [p.bl.x, p.bl.y, p.bl.x + arm, p.bl.y],
    [p.bl.x, p.bl.y, p.bl.x, p.bl.y + arm],
    [p.br.x, p.br.y, p.br.x - arm, p.br.y],
    [p.br.x, p.br.y, p.br.x, p.br.y + arm],
    [s.x, s.y, s.x + s.w, s.y],
    [s.x + s.w, s.y, s.x + s.w, s.y + s.h],
    [s.x + s.w, s.y + s.h, s.x, s.y + s.h],
    [s.x, s.y + s.h, s.x, s.y],
  ];
  for (let i = 0; i < n; i++) {
    const [x0, y0, x1, y1] = segs[i]!;
    const o = i * 6;
    set.positions[o] = x0;
    set.positions[o + 1] = y0;
    set.positions[o + 2] = HUD_Z;
    set.positions[o + 3] = x1;
    set.positions[o + 4] = y1;
    set.positions[o + 5] = HUD_Z;
    set.color[i] = Beam.GRID;
    set.intensity[i] = 1.05;
    set.width![i] = 1.6;
    set.flags![i] = BeamFlag.NO_FOG | BeamFlag.DWELL;
  }
  batch.setStatic(set);
}

export function createHud(opts: CreateHudOptions): Hud {
  const renderer = opts.renderer;
  const palette = opts.palette ?? renderer.palette;
  const scene = renderer.scenes.hud;

  const radar = createRadar(palette, { z: HUD_Z });
  const eeg = createEegTrace(palette, { z: HUD_Z });
  const vfd = createVfdStrip(palette, { z: HUD_Z });
  const bar = createBargraph(palette, { z: HUD_Z });
  const terminal = createTerminal(palette, { z: HUD_Z });
  const pip = createPip(palette, { z: HUD_Z, feed: renderer.targets.simstim.texture });
  const reticle = createReticle(palette, { z: HUD_Z });
  const chrome = createBeamBatch(palette, {
    capacity: 12,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.6, dwell: 0.9, dwellSigma: 2 },
  });
  chrome.object.name = 'HudPeriscope';
  chrome.material.depthTest = false;

  const objects = [
    radar.object,
    eeg.object,
    ...vfd.objects,
    bar.object,
    terminal.object,
    ...pip.objects,
    reticle.object,
    chrome.object,
  ];
  for (const obj of objects) scene.add(obj);

  const state: HudState = {
    neural: 23,
    trace: 34,
    flatline: false,
    scars: 1,
    mode: 'TRANSIT',
    speed: 80,
    coords: 'BAMA 0412.77 / 1180.03 / 0250',
    softs: DEFAULT_SOFTS.map((s) => ({ ...s })),
    blips: DEFAULT_BLIPS.map((b) => ({ ...b })),
    gripRemaining: null,
    lock: null,
  };

  let layout = layoutHud(renderer.cssWidth, renderer.cssHeight);
  let time = 0;
  let lastW = -1;
  let lastH = -1;

  const unsubs: Array<() => void> = [];
  const bus = opts.events;
  if (bus) {
    unsubs.push(
      bus.on('neuralChanged', (e) => {
        state.neural = e.value;
      }),
    );
    unsubs.push(
      bus.on('traceChanged', (e) => {
        state.trace = e.value;
      }),
    );
    unsubs.push(
      bus.on('flatline', () => {
        state.flatline = true;
      }),
    );
    unsubs.push(
      bus.on('dixieSay', (e) => {
        terminal.print(`DIXIE> ${e.lineId}`);
      }),
    );
    unsubs.push(
      bus.on('wintermute', (e) => {
        if (e.action.kind === 'hijack') terminal.print(e.action.text, { wintermute: true });
      }),
    );
    unsubs.push(
      bus.on('mollyPain', (e) => {
        pip.pain = e.amount;
      }),
    );
    unsubs.push(
      bus.on('simstimFlip', (e) => {
        pip.link = e.on;
      }),
    );
    unsubs.push(
      bus.on('modeChanged', (e) => {
        const id = e.to.toUpperCase();
        if (id === 'MATRIX') state.mode = 'TRANSIT';
        else if (id === 'FLATLINE') {
          state.mode = 'FLAT';
          state.flatline = true;
        } else state.mode = id;
      }),
    );
  }

  const applyLayout = (): void => {
    const L = layout;
    radar.layout(L.radar.x + L.radar.w * 0.5, L.radar.y + L.radar.h * 0.5, L.radar.w * 0.48, HUD_Z);
    eeg.layout(L.eeg.x, L.eeg.y, L.eeg.w, L.eeg.h, HUD_Z);
    vfd.layout({
      eegLabel: L.eegLabel,
      neural: L.neural,
      coords: L.coords,
      mode: L.mode,
      speed: L.speed,
      traceLabel: L.traceLabel,
      softs: L.softs,
      size: L.vfdSize,
      z: HUD_Z,
    });
    bar.layout(L.trace.x, L.trace.y, L.trace.w, L.trace.h, HUD_Z);
    terminal.layout(L.terminal.x, L.terminal.y, HUD_Z, L.terminalCell);
    pip.layout(L.pip.x, L.pip.y, L.pip.w, L.pip.h, HUD_Z);
    reticle.layout(L.reticle.x, L.reticle.y, L.reticleArm, HUD_Z);
    writeChrome(chrome, L);
  };

  const hud: Hud = {
    get layout() {
      return layout;
    },
    get state() {
      return state;
    },
    get terminalVisible() {
      return terminal.visible;
    },
    get terminalPending() {
      return terminal.pending;
    },
    get eegVariance() {
      return eegVariance(eeg.samples, eeg.sampleCount);
    },
    get pipLink() {
      return pip.link;
    },
    resize(width, height) {
      layout = layoutHud(width, height);
      lastW = width;
      lastH = height;
      applyLayout();
    },
    setNeural(value) {
      state.neural = Math.min(100, Math.max(0, value));
    },
    setTrace(value) {
      state.trace = Math.min(100, Math.max(0, value));
    },
    setFlatline(on) {
      state.flatline = on;
      if (on) state.mode = 'FLAT';
    },
    setScars(n) {
      state.scars = Math.max(0, n | 0);
    },
    setMode(mode) {
      state.mode = mode;
    },
    setSpeed(speed) {
      state.speed = Math.max(0, speed);
    },
    setCoords(coords) {
      state.coords = coords;
    },
    setPain(amount) {
      pip.pain = amount;
    },
    setPipLink(on) {
      pip.link = on;
    },
    setGrip(remaining) {
      state.gripRemaining = remaining;
      if (remaining != null) state.mode = 'GRIP';
    },
    setLock(lock) {
      state.lock = lock;
    },
    print(text, printOpts) {
      terminal.print(text, printOpts);
    },
    clearTerminal() {
      terminal.clear();
    },
    update(dt) {
      time += Math.max(0, dt);
      const w = renderer.cssWidth;
      const h = renderer.cssHeight;
      if (w !== lastW || h !== lastH) hud.resize(w, h);
      terminal.update(dt, time);
      eeg.update(time, state.neural, state.flatline, state.scars);
      radar.update(time, state.blips);
      bar.update(state.trace, time, opts.reduceFlashing?.() ?? true);
      vfd.update({
        coords: state.coords,
        mode: state.mode,
        speed: state.speed,
        neural: state.neural,
        softs: state.softs,
        gripRemaining: state.gripRemaining,
      });
      pip.setFeed(renderer.targets.simstim.texture);
      pip.update(time);
      reticle.update(state.lock);
    },
    dispose() {
      for (const u of unsubs) u();
      for (const obj of objects) scene.remove(obj);
      radar.dispose();
      eeg.dispose();
      vfd.dispose();
      bar.dispose();
      terminal.dispose();
      pip.dispose();
      reticle.dispose();
      chrome.dispose();
    },
  };

  applyLayout();
  lastW = renderer.cssWidth;
  lastH = renderer.cssHeight;
  if (terminal.visible === '') {
    terminal.print("DIXIE> that's a three-two, kid");
  }
  return hud;
}
