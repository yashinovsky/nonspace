/**
 * Dev route `?lab=text` (M3.1). Hershey (BeamBatch), Px437 bitmap, 7/14-seg VFD.
 */

import { Matrix4, Vector3 } from 'three';
import { createLoop } from '../core/loop';
import { createSaveStore } from '../core/save';
import { createSettingsStore, type QualitySetting } from '../core/settings';
import { Beam, createBeamBatch } from '../render/lines/BeamBatch';
import { createRenderer, type Renderer } from '../render/Renderer';
import { createBitmapText, createPx437Texture, PX437_ATLAS } from '../render/text/BitmapText';
import {
  asciiRange,
  hersheyBillboard,
  hersheyCapWorldForPixels,
  HERSHEY_SCREEN_FLAGS,
  layoutHershey,
  loadHersheyFont,
  type HersheyFont,
} from '../render/text/HersheyText';
import { createVfdText, VFD_GHOST } from '../render/text/VfdText';
import type { DebugGui } from './DebugGui';
import { createGpuTimer, type GpuTimer } from './gpuTimer';

export const TEXT_SCENES = ['all', 'hershey', 'bitmap', 'vfd'] as const;
export type TextScene = (typeof TEXT_SCENES)[number];

export function isTextScene(value: string | null): value is TextScene {
  return (TEXT_SCENES as readonly string[]).includes(value ?? '');
}

export const HERSHEY_CAP_PX = 16;

export interface TextLabHandle {
  readonly renderer: Renderer;
  readonly scene: TextScene;
  readonly hersheyCapPx: number;
  readonly vfdGhost: number;
  readonly ascii: string;
  readonly lastGpuMs: number | null;
  setScene(scene: TextScene): void;
  dispose(): void;
}

export interface TextLabOptions {
  debug?: boolean;
  qualityOverride?: QualitySetting;
  scene?: TextScene;
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

const ASCII = asciiRange();
const WORLD_TA = { x: 0, y: 0.85, z: 0 };
const WORLD_ESFA = { x: 2.8, y: 0.15, z: -0.4 };
const SCREEN_DIST = 2.4;

export async function startTextLab(
  root: HTMLElement,
  opts: TextLabOptions = {},
): Promise<TextLabHandle> {
  document.title = 'NONSPACE text lab';
  root.dataset.lab = 'text';

  const save = createSaveStore();
  save.load();
  const settings = createSettingsStore(save.data.settings, (s) => {
    save.data.settings = s;
    save.commit();
  });
  const renderer = createRenderer({
    parent: root,
    settings,
    qualityOverride: opts.qualityOverride,
  });
  renderer.dynamicRes.enabled = false;

  const simplex = await loadHersheyFont('/fonts/hershey/simplex.bin.gz');
  const atlas = PX437_ATLAS;
  const pxTexture = createPx437Texture();

  const taHershey = createBeamBatch(renderer.palette, { capacity: 4 });
  const esfaHershey = createBeamBatch(renderer.palette, { capacity: 4 });
  const screenHershey = createBeamBatch(renderer.palette, { capacity: 4 });
  renderer.scenes.matrix.add(taHershey.object);
  renderer.scenes.matrix.add(esfaHershey.object);
  renderer.scenes.matrix.add(screenHershey.object);

  const bitmap = createBitmapText(renderer.palette, pxTexture, atlas, {
    capacity: 128,
    cellSize: 0.16,
  });
  renderer.scenes.matrix.add(bitmap.object);

  const vfd14 = createVfdText(renderer.palette, { capacity: 96, ghost: true, size: 0.22 });
  const vfd7 = createVfdText(renderer.palette, { capacity: 24, ghost: true, size: 0.3 });
  renderer.scenes.matrix.add(vfd14.object);
  renderer.scenes.matrix.add(vfd7.object);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="text-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">TEXT · M3.1</div>
      <div data-testid="text-scene-label"></div>
      <div data-testid="text-stats" style="color:#6a8aaa;margin:0.25rem 0 0.55rem;font-size:12px"></div>
      <div class="row" style="display:flex;flex-wrap:wrap;gap:0.35rem" data-testid="text-scenes"></div>
    </div>
  `;
  const btnCss =
    'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer';
  const sceneRow = overlay.querySelector('[data-testid="text-scenes"]')!;
  for (const id of TEXT_SCENES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = id;
    b.style.cssText = btnCss;
    b.dataset.scene = id;
    b.dataset.testid = `text-scene-${id}`;
    sceneRow.appendChild(b);
  }
  root.appendChild(overlay);
  const label = overlay.querySelector('[data-testid="text-scene-label"]')!;
  const statsEl = overlay.querySelector('[data-testid="text-stats"]')!;

  let scene: TextScene = opts.scene ?? 'all';
  let lastGpuMs: number | null = null;
  let screenCapWorld = 0.08;
  const camPos = new Vector3();
  const screenLocal = new Matrix4();

  const layoutScreenHershey = (font: HersheyFont): void => {
    const cam = renderer.cameras.matrix;
    screenCapWorld = hersheyCapWorldForPixels(
      HERSHEY_CAP_PX,
      SCREEN_DIST,
      cam.fov,
      renderer.cssHeight,
    );
    const line = `HERSHEY ${HERSHEY_CAP_PX}PX  ${ASCII.slice(0, 40)}`;
    screenHershey.setStatic(
      layoutHershey(font, line, {
        capHeight: screenCapWorld,
        color: Beam.GRID,
        intensity: 1.45,
        width: 1.35,
        flags: HERSHEY_SCREEN_FLAGS,
        align: 'center',
      }),
    );
  };

  const applyScene = (next: TextScene): void => {
    scene = next;
    const hersheyOn = next === 'all' || next === 'hershey';
    const bitmapOn = next === 'all' || next === 'bitmap';
    const vfdOn = next === 'all' || next === 'vfd';
    taHershey.visible = hersheyOn;
    esfaHershey.visible = hersheyOn;
    screenHershey.visible = hersheyOn;
    bitmap.visible = bitmapOn;
    vfd14.visible = vfdOn;
    vfd7.visible = vfdOn;

    if (hersheyOn) {
      taHershey.setStatic(
        layoutHershey(simplex, 'T-A STRAYLIGHT', {
          capHeight: 0.42,
          color: Beam.TA,
          intensity: 1.7,
          width: 1.6,
          align: 'center',
        }),
      );
      esfaHershey.setStatic(
        layoutHershey(simplex, 'ESFA', {
          capHeight: 0.36,
          color: Beam.ESFA,
          intensity: 1.8,
          width: 1.5,
          align: 'center',
        }),
      );
      layoutScreenHershey(simplex);
    }
    if (bitmapOn) {
      const rows = [ASCII.slice(0, 32), ASCII.slice(32, 64), ASCII.slice(64)];
      bitmap.setText(rows.join('\n'), {
        color: Beam.GRID,
        intensity: 1.5,
        cellSize: 0.14,
        align: 'center',
      });
    }
    if (vfdOn) {
      vfd14.setText(`${ASCII.slice(32, 64)}\n${ASCII.slice(64)}`, {
        color: Beam.AMBER,
        intensity: 1.85,
        size: 0.2,
        mode: 14,
        ghost: true,
        align: 'center',
      });
      vfd7.setText('02:14:07  88.6', {
        color: Beam.AMBER,
        intensity: 2.1,
        size: 0.28,
        mode: 7,
        ghost: true,
        align: 'center',
      });
    }

    label.textContent = next.toUpperCase();
    root.dataset.scene = next;
    root.dataset.cap = String(HERSHEY_CAP_PX);
    root.dataset.ghost = String(VFD_GHOST);
    for (const btn of sceneRow.querySelectorAll('button')) {
      const on = (btn as HTMLButtonElement).dataset.scene === next;
      (btn as HTMLButtonElement).style.borderColor = on ? '#ffb000' : '#2a4a66';
    }
  };

  overlay.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).dataset.scene;
    if (id && isTextScene(id)) applyScene(id);
  });

  const resize = (): void => {
    renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    if (screenHershey.visible) layoutScreenHershey(simplex);
  };
  resize();
  window.addEventListener('resize', resize);

  let gui: DebugGui | null = null;
  let gpuTimer: GpuTimer | null = null;
  if (opts.debug) {
    gpuTimer = createGpuTimer(renderer.three.getContext() as WebGL2RenderingContext);
    const { createDebugGui: makeGui } = await import('./DebugGui');
    gui = makeGui({ gpuTimerAvailable: gpuTimer !== null });
    renderer.attachDebug(gui.pane);
  }

  const loop = createLoop({
    update() {
      const cam = renderer.cameras.matrix;
      cam.position.set(0.4, 0.55, 6.2);
      cam.lookAt(0, -0.45, 0);
      cam.updateMatrixWorld();
      cam.getWorldPosition(camPos);
      if (taHershey.visible) {
        hersheyBillboard(taHershey.transform, WORLD_TA, camPos);
        taHershey.object.updateMatrixWorld();
      }
      if (esfaHershey.visible) {
        hersheyBillboard(esfaHershey.transform, WORLD_ESFA, camPos);
        esfaHershey.object.updateMatrixWorld();
      }
      if (screenHershey.visible) {
        screenLocal.makeTranslation(0, screenCapWorld * 1.15, -SCREEN_DIST);
        screenHershey.transform.multiplyMatrices(cam.matrixWorld, screenLocal);
        screenHershey.object.updateMatrixWorld();
      }
      if (bitmap.visible) {
        hersheyBillboard(bitmap.transform, { x: 0, y: -0.85, z: 0.2 }, camPos);
        bitmap.object.updateMatrixWorld();
      }
      if (vfd14.visible) {
        hersheyBillboard(vfd14.transform, { x: 0, y: -1.25, z: 0.35 }, camPos);
        vfd14.object.updateMatrixWorld();
      }
      if (vfd7.visible) {
        hersheyBillboard(vfd7.transform, { x: 0, y: -1.6, z: 0.35 }, camPos);
        vfd7.object.updateMatrixWorld();
      }
    },
    render(_alpha, frameDt) {
      renderer.endFrame(frameDt, gpuTimer?.lastMs ?? null);
    },
  });

  let last = performance.now();
  let first = true;
  const frame = (now: number): void => {
    const dt = now - last;
    last = now;
    gpuTimer?.begin();
    loop.frame(now);
    gpuTimer?.end();
    lastGpuMs = gpuTimer ? gpuTimer.poll() : null;
    gui?.frame(dt, lastGpuMs);
    statsEl.textContent = `cap ${HERSHEY_CAP_PX}px · ghost ${(VFD_GHOST * 100).toFixed(0)}% · gpu ${
      lastGpuMs === null ? 'n/a' : `${lastGpuMs.toFixed(2)} ms`
    }`;
    if (first) {
      first = false;
      root.dataset.status = 'running';
    }
  };
  const startCam = renderer.cameras.matrix;
  startCam.position.set(0.4, 0.55, 6.2);
  startCam.lookAt(0, -0.45, 0);
  startCam.updateMatrixWorld();
  applyScene(scene);
  renderer.three.setAnimationLoop(frame);

  const handle: TextLabHandle = {
    renderer,
    get scene() {
      return scene;
    },
    hersheyCapPx: HERSHEY_CAP_PX,
    vfdGhost: VFD_GHOST,
    ascii: ASCII,
    get lastGpuMs() {
      return lastGpuMs;
    },
    setScene: applyScene,
    dispose() {
      renderer.three.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      overlay.remove();
      renderer.scenes.matrix.remove(taHershey.object);
      renderer.scenes.matrix.remove(esfaHershey.object);
      renderer.scenes.matrix.remove(screenHershey.object);
      renderer.scenes.matrix.remove(bitmap.object);
      renderer.scenes.matrix.remove(vfd14.object);
      renderer.scenes.matrix.remove(vfd7.object);
      taHershey.dispose();
      esfaHershey.dispose();
      screenHershey.dispose();
      bitmap.dispose();
      vfd14.dispose();
      vfd7.dispose();
      pxTexture.dispose();
      gpuTimer?.dispose();
      gui?.dispose();
      renderer.dispose();
      if (window.__nonspaceText === handle) delete window.__nonspaceText;
    },
  };
  window.__nonspaceText = handle;
  (window as unknown as { __nonspace: { renderer: Renderer; textLab: TextLabHandle } }).__nonspace =
    { renderer, textLab: handle };
  return handle;
}

declare global {
  interface Window {
    __nonspaceText?: TextLabHandle;
  }
}
