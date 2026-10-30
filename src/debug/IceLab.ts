/**
 * Dev route `?lab=ice` (M4.2). White / gray / black ICE shells, telegraph,
 * shatter, black-ICE grip tendrils. Query:
 * `?lab=ice&scene=trio|white|gray|black|shatter|telegraph|grip&gray=1&quality=high`.
 * Lazy-imported from App so the default-boot graph never fetches it.
 */

import { Vector3 } from 'three';
import type { SfxId } from '../audio/AudioEngine';
import { createIceModel, type IceClass, type IceDef, type IceModel } from '../breach/IceModel';
import { createIceVisuals, SHATTER_DURATION, type IceVisuals } from '../breach/IceVisuals';
import { BLACK_ICE } from '../content/ice/black';
import { GRAY_ICE } from '../content/ice/gray';
import { WHITE_ICE } from '../content/ice/white';
import { BEAM_COUNT, type Beam } from '../render/lines/BeamBatch';
import type { Palette } from '../render/palette';
import { asBlackIceComposite } from '../render/post/BlackIceComposite';
import type { Renderer } from '../render/Renderer';

export const ICE_SCENES = [
  'trio',
  'white',
  'gray',
  'black',
  'shatter',
  'telegraph',
  'grip',
] as const;
export type IceScene = (typeof ICE_SCENES)[number];

export function isIceScene(value: string | null): value is IceScene {
  return (ICE_SCENES as readonly string[]).includes(value ?? '');
}

export interface ScreenXy {
  x: number;
  y: number;
}

export interface IceLab {
  update(dt: number): void;
  dispose(): void;
  readonly scene: IceScene;
  readonly grayscale: boolean;
}

export interface IceLabHandle {
  scene: IceScene;
  grayscale: boolean;
  time: number;
  lastSfx: readonly SfxId[];
  telegraphFlicker: number;
  grip: number;
  shatterTime: number;
  shatterDuration: number;
  whiteScreen: ScreenXy;
  grayScreen: ScreenXy;
  blackScreen: ScreenXy;
  setScene(scene: IceScene): void;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
  forceTelegraph(): void;
  forceGrip(): void;
  shatter(): void;
  advance(dt: number): void;
}

declare global {
  interface Window {
    __nonspaceIce?: IceLabHandle;
  }
}

export interface IceLabOptions {
  renderer: Renderer;
  root: HTMLElement;
  scene?: string | null;
  gray?: string | null;
  reduceMotion?: () => boolean;
}

const CSS = [
  'position:fixed',
  'inset:0',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:20',
].join(';');

const PANEL = [
  'position:absolute',
  'pointer-events:auto',
  'left:1rem',
  'top:1rem',
  'min-width:18rem',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #1a3348',
].join(';');

const BTN =
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer;margin:0 0.25rem 0.25rem 0';

const DEFS: Record<Exclude<IceClass, 'ta'>, IceDef> = {
  white: WHITE_ICE,
  gray: GRAY_ICE,
  black: BLACK_ICE,
};

const SLOT: Record<Exclude<IceClass, 'ta'>, { x: number; y: number; z: number }> = {
  white: { x: -16, y: 0, z: 0 },
  gray: { x: 0, y: 0, z: 0 },
  black: { x: 16, y: 0, z: 0 },
};

const CAM = {
  trio: { x: 0, y: 4.2, z: 38 },
  single: { x: 0, y: 2.4, z: 24 },
} as const;

/** Rec. 709 luma. `reset()` first so a second call does not gray already-gray values. */
export function setPaletteGrayscale(palette: Palette, on: boolean): void {
  palette.reset();
  if (!on) return;
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < BEAM_COUNT; i++) {
    palette.get(i as Beam, rgb);
    const y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    palette.set(i as Beam, { r: y, g: y, b: y });
  }
}

function project(renderer: Renderer, x: number, y: number, z: number): ScreenXy {
  const v = new Vector3(x, y, z);
  renderer.cameras.matrix.updateMatrixWorld();
  v.project(renderer.cameras.matrix);
  return {
    x: (v.x * 0.5 + 0.5) * renderer.cssWidth,
    y: (-v.y * 0.5 + 0.5) * renderer.cssHeight,
  };
}

export function installIceLab(opts: IceLabOptions): IceLab {
  const { renderer, root } = opts;
  const sceneArg = opts.scene ?? null;
  const startScene: IceScene = isIceScene(sceneArg) ? sceneArg : 'trio';

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="ice-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">ICE · M4.2</div>
      <div data-testid="ice-stats" style="color:#c8e4ff;margin:0 0 0.45rem;font-size:12px;white-space:pre"></div>
      <div>
        <button type="button" data-testid="ice-gray" style="${BTN}">grayscale</button>
        <button type="button" data-testid="ice-telegraph" style="${BTN}">re-key</button>
        <button type="button" data-testid="ice-shatter" style="${BTN}">shatter</button>
        <button type="button" data-testid="ice-grip" style="${BTN}">grip</button>
      </div>
      <div style="color:#6a8aaa;font-size:11px;margin-top:0.35rem">click to unlock mock sfx</div>
    </div>
  `;
  root.appendChild(overlay);
  const statsEl = overlay.querySelector('[data-testid="ice-stats"]')!;
  const grayBtn = overlay.querySelector('[data-testid="ice-gray"]') as HTMLButtonElement;
  const telegraphBtn = overlay.querySelector('[data-testid="ice-telegraph"]') as HTMLButtonElement;
  const shatterBtn = overlay.querySelector('[data-testid="ice-shatter"]') as HTMLButtonElement;
  const gripBtn = overlay.querySelector('[data-testid="ice-grip"]') as HTMLButtonElement;

  let scene = startScene;
  let grayscale = opts.gray === '1' || opts.gray === 'true';
  let time = 0;
  const lastSfx: SfxId[] = [];
  let audio: { sfx(id: SfxId): void; unlock(): Promise<void> } | null = null;

  type Slot = {
    cls: Exclude<IceClass, 'ta'>;
    model: IceModel;
    visuals: IceVisuals;
  };
  let slots: Slot[] = [];

  const playSfx = (id: SfxId): void => {
    lastSfx.push(id);
    audio?.sfx(id);
  };

  const poseCamera = (): void => {
    const cam = renderer.cameras.matrix;
    const single = scene !== 'trio';
    const p = single ? CAM.single : CAM.trio;
    cam.position.set(p.x, p.y, p.z);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
  };

  const classesFor = (s: IceScene): Array<Exclude<IceClass, 'ta'>> => {
    if (s === 'white' || s === 'shatter') return ['white'];
    if (s === 'gray' || s === 'telegraph') return ['gray'];
    if (s === 'black' || s === 'grip') return ['black'];
    return ['white', 'gray', 'black'];
  };

  const clearSlots = (): void => {
    for (const sl of slots) sl.visuals.dispose();
    slots = [];
  };

  const rebuild = (): void => {
    clearSlots();
    const classes = classesFor(scene);
    const trio = classes.length > 1;
    for (const cls of classes) {
      const def = DEFS[cls];
      const pos = trio ? SLOT[cls] : { x: 0, y: 0, z: 0 };
      const model = createIceModel(def, { seed: cls === 'white' ? 1 : cls === 'gray' ? 2 : 3 });
      model.engage(0);
      const visuals = createIceVisuals({
        renderer,
        def,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        driveGrip: cls === 'black',
      });
      slots.push({ cls, model, visuals });
    }
    poseCamera();
    lastSfx.length = 0;
  };

  const slot = (cls: Exclude<IceClass, 'ta'>): Slot | undefined => slots.find((s) => s.cls === cls);

  const forceTelegraph = (): void => {
    const s = slot('gray') ?? slots[0];
    if (!s) return;
    s.model.forceTelegraph();
    playSfx('rekeyTelegraph');
  };

  const forceGrip = (): void => {
    const s = slot('black') ?? slots[0];
    if (!s) return;
    s.model.forceGrip('neural');
  };

  const shatterNow = (): void => {
    const s = slot('white') ?? slots[0];
    if (!s) return;
    s.model.crack();
    s.visuals.shatter(0x51c);
    playSfx('shatter');
  };

  const applyGray = (): void => {
    setPaletteGrayscale(renderer.palette, grayscale);
    root.dataset.gray = grayscale ? '1' : '0';
    grayBtn.style.borderColor = grayscale ? '#ffb000' : '#2a4a66';
    grayBtn.textContent = grayscale ? 'grayscale on' : 'grayscale';
  };

  const projectPos = (cls: Exclude<IceClass, 'ta'>): ScreenXy => {
    const s = slot(cls);
    const p = s?.visuals.object.position ?? new Vector3();
    return project(renderer, p.x, p.y, p.z);
  };

  const syncHud = (): void => {
    const g = slot('gray');
    const b = slot('black');
    const w = slot('white') ?? slots[0];
    const tel = g?.visuals.telegraphFlicker ?? 0;
    const grip = b?.visuals.grip ?? 0;
    const sh = w?.visuals.shatterTime ?? -1;
    statsEl.textContent = [
      `scene ${scene}${grayscale ? '  GRAY' : ''}`,
      `telegraph ${tel.toFixed(2)}  grip ${grip.toFixed(2)}`,
      `shatter ${sh < 0 ? '—' : sh.toFixed(2) + ' / ' + SHATTER_DURATION.toFixed(1)}s`,
      `sfx ${lastSfx[lastSfx.length - 1] ?? '—'}`,
    ].join('\n');
    root.dataset.lab = 'ice';
    root.dataset.scene = scene;
    root.dataset.gray = grayscale ? '1' : '0';
    root.dataset.telegraph = tel > 0.05 ? '1' : '0';
    root.dataset.grip = grip > 0.5 ? '1' : '0';
    root.dataset.shatter = sh >= 0 && sh < SHATTER_DURATION ? '1' : '0';
    root.dataset.persist = renderer.quality.persistence ? '1' : '0';
  };

  const step = (dt: number): void => {
    time += dt;
    const cam = renderer.cameras.matrix;
    const reduce = opts.reduceMotion?.() ?? false;
    const perfect = (m: IceModel): { R: number; Phi: number } => {
      const [a, b] = m.state.current.ratio;
      return { R: b / a, Phi: m.state.current.phi - m.state.current.roll };
    };
    for (const sl of slots) {
      sl.model.step(dt, perfect(sl.model));
      sl.visuals.update(dt, sl.model, cam, reduce);
    }
    syncHud();
  };

  grayBtn.addEventListener('click', () => {
    grayscale = !grayscale;
    applyGray();
  });
  telegraphBtn.addEventListener('click', () => forceTelegraph());
  shatterBtn.addEventListener('click', () => shatterNow());
  gripBtn.addEventListener('click', () => forceGrip());
  overlay.addEventListener('click', () => {
    void (async () => {
      if (audio) return;
      const { createAudioEngine } = await import('../audio/AudioEngine');
      const eng = createAudioEngine();
      await eng.unlock();
      audio = eng;
    })();
  });

  const handle: IceLabHandle = {
    get scene() {
      return scene;
    },
    get grayscale() {
      return grayscale;
    },
    get time() {
      return time;
    },
    get lastSfx() {
      return lastSfx;
    },
    get telegraphFlicker() {
      return slot('gray')?.visuals.telegraphFlicker ?? slots[0]?.visuals.telegraphFlicker ?? 0;
    },
    get grip() {
      return slot('black')?.visuals.grip ?? 0;
    },
    get shatterTime() {
      return slot('white')?.visuals.shatterTime ?? slots[0]?.visuals.shatterTime ?? -1;
    },
    shatterDuration: SHATTER_DURATION,
    get whiteScreen() {
      return projectPos('white');
    },
    get grayScreen() {
      return projectPos('gray');
    },
    get blackScreen() {
      return projectPos('black');
    },
    setScene(next) {
      scene = next;
      rebuild();
      if (scene === 'telegraph') forceTelegraph();
      if (scene === 'grip') forceGrip();
      if (scene === 'shatter') shatterNow();
      syncHud();
    },
    setGrayscale(on) {
      grayscale = on;
      applyGray();
    },
    setTime(t) {
      time = t;
      for (const sl of slots) sl.visuals.setTime(t);
    },
    forceTelegraph,
    forceGrip,
    shatter: shatterNow,
    advance(dt) {
      step(dt);
    },
  };
  window.__nonspaceIce = handle;

  rebuild();
  if (scene === 'telegraph') forceTelegraph();
  if (scene === 'grip') forceGrip();
  if (scene === 'shatter') shatterNow();
  applyGray();
  poseCamera();
  syncHud();

  return {
    get scene() {
      return scene;
    },
    get grayscale() {
      return grayscale;
    },
    update(dt) {
      step(dt);
    },
    dispose() {
      overlay.remove();
      clearSlots();
      asBlackIceComposite(renderer.chain.getPass('blackIce')).grip = 0;
      renderer.palette.reset();
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.gray;
      delete root.dataset.telegraph;
      delete root.dataset.grip;
      delete root.dataset.shatter;
      delete root.dataset.persist;
      if (window.__nonspaceIce === handle) delete window.__nonspaceIce;
    },
  };
}
