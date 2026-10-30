/**
 * Dev route `?lab=flight` (M2.5). A first-person fly-through of a ground grid,
 * a short vertical lattice, and two hulls (construct + ICE) so grid assist,
 * the ceiling and soft collision can be felt without the render skeleton.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Scene,
  BoxGeometry,
  IcosahedronGeometry,
} from 'three';
import type { WebGLRenderer } from 'three';
import type { FlightController } from './FlightController';
import type { CameraRig } from './CameraRig';
import { aabbHull, sphereHull } from './Collision';

export interface FlightLab {
  readonly scene: Scene;
  render(alpha: number): void;
  dispose(): void;
}

export interface FlightLabOptions {
  renderer: WebGLRenderer;
  flight: FlightController;
  cameraRig: CameraRig;
  root: HTMLElement;
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
  'min-width:16rem',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #1a3348',
].join(';');

function makeGrid(size: number, step: number, y: number, color: number): LineSegments {
  const half = size / 2;
  const pos: number[] = [];
  for (let i = -half; i <= half; i += step) {
    pos.push(-half, y, i, half, y, i);
    pos.push(i, y, -half, i, y, half);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({ color, toneMapped: false });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

function makeLattice(color: number): LineSegments {
  const pos: number[] = [];
  const xs = [-80, -40, 0, 40, 80];
  const zs = [-200, -160, -120, -80, -40, 0];
  for (const x of xs) {
    for (const z of zs) {
      pos.push(x, 0, z, x, 80, z);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({ color, toneMapped: false });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

export function createFlightLab(opts: FlightLabOptions): FlightLab {
  const { renderer, flight, cameraRig, root } = opts;
  const scene = new Scene();
  scene.background = new Color(0x000000);

  scene.add(makeGrid(4000, 40, 0, 0x152838));
  scene.add(makeGrid(4000, 200, 0, 0x3a6a88));
  scene.add(makeLattice(0x1c3a52));

  const constructMat = new MeshBasicMaterial({
    color: 0xffb000,
    wireframe: true,
    toneMapped: false,
  });
  const iceMat = new MeshBasicMaterial({
    color: 0xa8d8ff,
    wireframe: true,
    toneMapped: false,
  });

  const cube = new Mesh(new BoxGeometry(40, 40, 40), constructMat);
  cube.position.set(90, 20, -180);
  scene.add(cube);
  flight.collision.add(aabbHull('lab-construct', 'construct', 70, 0, -200, 110, 40, -160));

  const ice = new Mesh(new IcosahedronGeometry(18, 0), iceMat);
  ice.position.set(-70, 22, -160);
  scene.add(ice);
  flight.collision.add(sphereHull('lab-ice', 'ice', -70, 22, -160, 18));

  flight.setPose({
    x: 0,
    y: 24,
    z: 40,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    bank: 0,
    fov: flight.params.fovBase,
  });

  const overlay = document.createElement('div');
  overlay.dataset.testid = 'flight-lab';
  overlay.style.cssText = CSS;
  const panel = document.createElement('div');
  panel.style.cssText = PANEL;
  overlay.appendChild(panel);
  root.appendChild(overlay);

  const readout = document.createElement('pre');
  readout.dataset.testid = 'flight-readout';
  readout.style.cssText = 'margin:0 0 0.6rem;color:#c8e4ff;font:12px/1.45 inherit;white-space:pre';
  panel.appendChild(readout);

  const hint = document.createElement('div');
  hint.style.cssText = 'color:#6a8aaa;font-size:11px;margin:0 0 0.55rem';
  hint.textContent = 'WASD thrust/strafe · Space/Ctrl rise/fall · Shift boost · click to look';
  panel.appendChild(hint);

  const toggles = document.createElement('div');
  toggles.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem';
  panel.appendChild(toggles);

  const addToggle = (
    key: 'gridAssist' | 'banking' | 'fovKickEnabled',
    label: string,
  ): HTMLInputElement => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:0.45rem;align-items:center;color:#ffb000;cursor:pointer';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = flight.params[key];
    box.dataset.testid = `flight-toggle-${key}`;
    box.addEventListener('change', () => {
      flight.params[key] = box.checked;
    });
    row.append(box, document.createTextNode(label));
    toggles.appendChild(row);
    return box;
  };
  const gridBox = addToggle('gridAssist', 'Grid assist (15° / 30°/s)');
  const bankBox = addToggle('banking', 'Banking (visual, 6°)');
  const fovBox = addToggle('fovKickEnabled', 'FOV kick (+12°)');

  const title = document.createElement('div');
  title.style.cssText = 'letter-spacing:0.22em;color:#ffb000;margin:0 0 0.45rem;font-size:11px';
  title.textContent = 'FLIGHT  ·  M2.5';
  panel.insertBefore(title, readout);

  const fmt = (n: number, d = 1): string => n.toFixed(d);

  const lab: FlightLab = {
    scene,
    render(alpha) {
      cameraRig.apply(flight, alpha);
      renderer.render(scene, cameraRig.camera);
      const t = flight.telemetry;
      readout.textContent = [
        `speed     ${fmt(t.speed, 1)} u/s`,
        `altitude  ${fmt(t.altitude, 1)} u`,
        `heading   ${fmt(t.headingDeg, 1)}°`,
        `pitch     ${fmt(t.pitchDeg, 1)}°`,
        `bank      ${fmt(t.bankDeg, 2)}°`,
        `fov       ${fmt(t.fov, 1)}°`,
        `assist    ${t.gridAssistActive ? 'SNAP' : '—'}`,
        `ceiling   ${t.ceilingActive ? 'SOFT' : '—'}`,
        `hull      ${t.hullContact ? `${t.iceContact ? 'ICE' : 'CONSTRUCT'} flare ${fmt(t.flare, 2)}` : '—'}`,
      ].join('\n');
      gridBox.checked = flight.params.gridAssist;
      bankBox.checked = flight.params.banking;
      fovBox.checked = flight.params.fovKickEnabled;
    },
    dispose() {
      overlay.remove();
      scene.traverse((obj) => {
        const mesh = obj as Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    },
  };
  return lab;
}
