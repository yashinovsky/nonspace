/**
 * Dev route `?lab=grid` (M1.3). Ground grid (analytic AA, checker, warp) plus
 * the camera-centred 3D lattice (BeamBatch, spherical fade).
 */

import type { Renderer } from '../render/Renderer';
import {
  createGroundGrid,
  warpXZ,
  type GroundGrid,
  type WarpPoint,
} from '../render/grid/GroundGrid';
import { createLocalLattice, type LocalLattice } from '../render/grid/LocalLattice';

export const GRID_SCENES = ['cruise', 'graze', 'high', 'warp', 'lattice'] as const;
export type GridScene = (typeof GRID_SCENES)[number];

export function isGridScene(value: string | null): value is GridScene {
  return (GRID_SCENES as readonly string[]).includes(value ?? '');
}

export interface GridLab {
  update(dt: number): void;
  dispose(): void;
  setScene(scene: GridScene): void;
  readonly scene: GridScene;
  readonly latticeCount: number;
  readonly altitude: number;
  readonly warpEnabled: boolean;
  readonly grid: GroundGrid;
  readonly lattice: LocalLattice;
}

export interface GridLabOptions {
  scene?: GridScene;
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
  'background:#071018;color:#a8d8ff;border:1px solid #2a4a66;padding:0.28rem 0.5rem;font:inherit;cursor:pointer';

const WARP_POINTS: WarpPoint[] = [
  { x: 128, z: 0, radius: 180, strength: 0.7 },
  { x: -120, z: 96, radius: 160, strength: 0.55 },
  { x: 16, z: -176, radius: 200, strength: -0.5 },
  { x: 96, z: 160, radius: 140, strength: 0.65 },
];

function placeCamera(renderer: Renderer, scene: GridScene): void {
  const cam = renderer.cameras.matrix;
  cam.near = 0.5;
  cam.far = 60_000;
  cam.fov = 75;
  if (scene === 'graze') {
    cam.position.set(0, 2.15, 48);
    cam.lookAt(0, 0, -1400);
  } else if (scene === 'high') {
    cam.position.set(40, 5000, 80);
    cam.lookAt(0, 0, 0);
  } else if (scene === 'lattice') {
    cam.position.set(20, 48, 36);
    cam.lookAt(20, 36, -80);
  } else if (scene === 'warp') {
    cam.position.set(36, 42, 110);
    cam.lookAt(0, 0, 0);
  } else {
    cam.position.set(48, 24, 96);
    cam.lookAt(0, 4, 0);
  }
  cam.updateProjectionMatrix();
}

export function installGridLab(
  renderer: Renderer,
  root: HTMLElement,
  opts: GridLabOptions = {},
): GridLab {
  const grid = createGroundGrid(renderer.palette);
  const lattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);

  const overlay = document.createElement('div');
  overlay.style.cssText = CSS;
  overlay.innerHTML = `
    <div style="${PANEL}" data-testid="grid-lab">
      <div style="letter-spacing:0.28em;font-size:11px;color:#6a8aaa;margin:0 0 0.35rem">GRID · M1.3</div>
      <div data-testid="grid-scene-label"></div>
      <div data-testid="grid-stats" style="color:#6a8aaa;margin:0.25rem 0 0.55rem;font-size:12px"></div>
      <div class="row" style="display:flex;flex-wrap:wrap;gap:0.35rem" data-testid="grid-scenes"></div>
    </div>
  `;
  const sceneRow = overlay.querySelector('[data-testid="grid-scenes"]')!;
  for (const id of GRID_SCENES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = id;
    b.style.cssText = BTN;
    b.dataset.scene = id;
    b.dataset.testid = `grid-scene-${id}`;
    sceneRow.appendChild(b);
  }
  root.appendChild(overlay);

  const label = overlay.querySelector('[data-testid="grid-scene-label"]')!;
  const statsEl = overlay.querySelector('[data-testid="grid-stats"]')!;

  let scene: GridScene = opts.scene ?? 'cruise';
  let time = 0;
  const sample = { x: 80, z: 0 };

  const applyScene = (next: GridScene): void => {
    scene = next;
    time = 0;
    placeCamera(renderer, scene);
    if (next === 'warp') grid.setWarp(WARP_POINTS);
    else grid.setWarp([]);
    // Graze/high isolate the ground plane so the horizon-black and 5,000 u
    // altitude ACs are not covered by the local cage.
    lattice.visible = next !== 'graze' && next !== 'high';
    lattice.radius = renderer.quality.latticeRadius;
    lattice.update(renderer.cameras.matrix.position);
    label.textContent = scene.toUpperCase();
    root.dataset.scene = scene;
    root.dataset.warp = next === 'warp' ? '1' : '0';
    const bent = warpXZ(sample.x, sample.z, next === 'warp' ? WARP_POINTS : []);
    root.dataset.warpDelta = String(Math.hypot(bent.x - sample.x, bent.z - sample.z));
    for (const btn of sceneRow.querySelectorAll('button')) {
      const on = (btn as HTMLButtonElement).dataset.scene === scene;
      (btn as HTMLButtonElement).style.borderColor = on ? '#ffb000' : '#2a4a66';
    }
  };

  overlay.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).dataset.scene;
    if (id && isGridScene(id)) applyScene(id);
  });

  const syncHud = (): void => {
    const cam = renderer.cameras.matrix;
    const alt = cam.position.y;
    root.dataset.altitude = alt.toFixed(2);
    root.dataset.latticeCount = String(lattice.count);
    root.dataset.latticeRadius = String(lattice.radius);
    statsEl.textContent = [
      `alt ${alt.toFixed(1)} u`,
      `lattice ${lattice.count} / r ${lattice.radius}`,
      scene === 'warp' ? 'warp 4 pts' : 'warp off',
    ].join(' · ');
  };

  applyScene(scene);
  syncHud();

  const lab: GridLab = {
    grid,
    lattice,
    get scene() {
      return scene;
    },
    get latticeCount() {
      return lattice.count;
    },
    get altitude() {
      return renderer.cameras.matrix.position.y;
    },
    get warpEnabled() {
      return scene === 'warp';
    },
    setScene: applyScene,
    update(dt) {
      time += dt;
      lattice.radius = renderer.quality.latticeRadius;
      const cam = renderer.cameras.matrix;
      if (scene === 'cruise' || scene === 'warp' || scene === 'lattice') {
        const r = scene === 'lattice' ? 40 : scene === 'warp' ? 118 : 104;
        const y = scene === 'lattice' ? 48 : scene === 'warp' ? 42 : 24;
        cam.position.set(Math.sin(time * 0.08) * r, y, Math.cos(time * 0.08) * r);
        cam.lookAt(0, scene === 'lattice' ? 36 : 4, 0);
      }
      grid.follow(cam.position);
      lattice.update(cam.position);
      syncHud();
    },
    dispose() {
      overlay.remove();
      renderer.scenes.matrix.remove(grid.object);
      renderer.scenes.matrix.remove(lattice.object);
      grid.dispose();
      lattice.dispose();
      delete root.dataset.scene;
      delete root.dataset.warp;
      delete root.dataset.warpDelta;
      delete root.dataset.altitude;
      delete root.dataset.latticeCount;
      delete root.dataset.latticeRadius;
      if (window.__nonspaceGrid === lab) delete window.__nonspaceGrid;
    },
  };
  window.__nonspaceGrid = lab;
  return lab;
}

declare global {
  interface Window {
    __nonspaceGrid?: GridLab;
  }
}
