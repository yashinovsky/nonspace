/**
 * Dev route `?lab=sky` (M2.4). 40k sky points in one draw, 0.1× parallax,
 * a ground grid for scale, and ground/ceiling/fly views so the arms read as
 * unreachable at the 12,000 u ceiling.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';
import { poseFromForward, type FlightController } from '../../player/FlightController';
import type { Renderer } from '../../render/Renderer';
import {
  CEILING_ALTITUDE,
  createSky,
  SKY_ALTITUDE,
  SKY_PARALLAX,
  SKY_POINT_COUNT,
  SKY_SPIN_RAD_PER_SEC,
  skyApparentRange,
  type Sky,
} from './Sky';

export type SkyLabView = 'look' | 'ground' | 'ceiling' | 'fly';

export interface SkyLab {
  readonly sky: Sky;
  view: SkyLabView;
  setView(view: SkyLabView): void;
  update(dt: number): void;
  dispose(): void;
}

export interface SkyLabOptions {
  renderer: Renderer;
  root: HTMLElement;
  flight?: FlightController;
  reduceMotion?: () => boolean;
}

const CSS = [
  'position:fixed',
  'left:1rem',
  'top:1rem',
  'z-index:20',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#b9a6ff',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #2a2450',
  'white-space:pre',
].join(';');

const LOOK = {
  look: { pos: new Vector3(4_200, 900, 11_000), at: new Vector3(0, 26_000, -2_000) },
  ground: { pos: new Vector3(2_000, 600, 14_000), at: new Vector3(0, 24_000, -4_000) },
  ceiling: {
    pos: new Vector3(2_000, CEILING_ALTITUDE, 14_000),
    at: new Vector3(0, 28_000, -4_000),
  },
};

function parseView(raw: string | null): SkyLabView {
  if (raw === 'ground' || raw === 'ceiling' || raw === 'fly' || raw === 'look') return raw;
  return 'look';
}

function makeGroundGrid(): LineSegments {
  const pos: number[] = [];
  const half = 2_048;
  const step = 64;
  for (let i = -half; i <= half; i += step) {
    pos.push(-half, 0, i, half, 0, i);
    pos.push(i, 0, -half, i, 0, half);
  }
  const major = 1_024;
  for (let i = -half; i <= half; i += major) {
    pos.push(-half, 0, i, half, 0, i);
    pos.push(i, 0, -half, i, 0, half);
  }
  for (const x of [-64, 0, 64, 128]) {
    for (const z of [-64, 0, 64]) {
      pos.push(x, 0, z, x, 1_800, z);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({
    color: 0x14304a,
    toneMapped: false,
    transparent: true,
    opacity: 0.5,
  });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'skyLabGrid';
  return lines;
}

function applyLook(
  cam: Renderer['cameras']['matrix'],
  pos: Vector3,
  at: Vector3,
  flight?: FlightController,
): void {
  cam.near = 0.5;
  cam.far = 60_000;
  cam.fov = 75;
  cam.rotation.order = 'YXZ';
  cam.position.copy(pos);
  cam.lookAt(at);
  cam.updateProjectionMatrix();
  if (flight) {
    const fwd = new Vector3().subVectors(at, pos).normalize();
    const look = { yaw: 0, pitch: 0 };
    poseFromForward(fwd.x, fwd.y, fwd.z, look);
    flight.setPose({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: look.yaw,
      pitch: look.pitch,
      bank: 0,
      fov: cam.fov,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }
}

export function installSkyLab(opts: SkyLabOptions): SkyLab {
  const { renderer, root, flight, reduceMotion } = opts;
  const sky = createSky({ palette: renderer.palette, parent: renderer.scenes.sky });
  const grid = makeGroundGrid();
  renderer.scenes.matrix.add(grid);

  const cam = renderer.cameras.matrix;
  const panel = document.createElement('div');
  panel.style.cssText = CSS;
  panel.dataset.testid = 'sky-lab';
  root.appendChild(panel);

  let view: SkyLabView = parseView(new URLSearchParams(window.location.search).get('view'));
  let time = 0;

  const applyView = (next: SkyLabView): void => {
    view = next;
    if (next === 'fly') {
      if (flight) {
        cam.rotation.order = 'YXZ';
        cam.near = 0.5;
        cam.far = 60_000;
        cam.position.set(flight.pose.x, flight.pose.y, flight.pose.z);
        cam.rotation.set(flight.pose.pitch, flight.pose.yaw, flight.pose.bank);
        cam.fov = flight.pose.fov;
        cam.updateProjectionMatrix();
      }
      return;
    }
    const preset = LOOK[next];
    applyLook(cam, preset.pos, preset.at, flight);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === '1') applyView('ground');
    else if (ev.key === '2') applyView('ceiling');
    else if (ev.key === '3') applyView('fly');
    else if (ev.key === '0') applyView('look');
  };
  window.addEventListener('keydown', onKey);

  applyView(view);

  sky.batch.setViewport(renderer.internalWidth, renderer.internalHeight);
  root.dataset.skyPoints = String(sky.batch.drawCount);
  root.dataset.skyDraws = '1';
  root.dataset.skyParallax = String(SKY_PARALLAX);
  root.dataset.skyAltitude = String(SKY_ALTITUDE);
  root.dataset.skyCeiling = String(CEILING_ALTITUDE);
  root.dataset.skySpin = SKY_SPIN_RAD_PER_SEC.toExponential(3);

  const sync = (): void => {
    const range = skyApparentRange(cam.position.y);
    root.dataset.skyCamY = cam.position.y.toFixed(1);
    root.dataset.skyRange = range.toFixed(1);
    root.dataset.skyAngle = sky.angle.toExponential(4);
    root.dataset.skyView = view;
    panel.textContent = [
      'M2.4 sky',
      `points   ${SKY_POINT_COUNT}  (1 draw)`,
      `parallax ${SKY_PARALLAX}×`,
      `spin     ${SKY_SPIN_RAD_PER_SEC.toExponential(2)} rad/s`,
      `cam y    ${cam.position.y.toFixed(0)} u`,
      `range    ${range.toFixed(0)} u  (disc)`,
      `view     ${view}   1 ground  2 ceiling  3 fly`,
    ].join('\n');
  };
  sync();

  const lab: SkyLab = {
    sky,
    get view() {
      return view;
    },
    set view(v) {
      applyView(v);
    },
    setView(v) {
      applyView(v);
    },
    update(dt) {
      time += dt;
      if (view === 'fly' && flight) {
        cam.rotation.order = 'YXZ';
        cam.position.set(flight.pose.x, flight.pose.y, flight.pose.z);
        cam.rotation.set(flight.pose.pitch, flight.pose.yaw, flight.pose.bank);
        if (cam.fov !== flight.pose.fov) {
          cam.fov = flight.pose.fov;
          cam.updateProjectionMatrix();
        }
      }
      sky.update(cam, dt, {
        viewport: { width: renderer.internalWidth, height: renderer.internalHeight },
        reduceMotion: reduceMotion?.() ?? false,
        time,
      });
      sync();
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      renderer.scenes.matrix.remove(grid);
      grid.geometry.dispose();
      (grid.material as LineBasicMaterial).dispose();
      sky.dispose();
      panel.remove();
      if (window.__skyLab === lab) delete window.__skyLab;
    },
  };

  window.__skyLab = lab;
  return lab;
}

declare global {
  interface Window {
    __skyLab?: SkyLab;
  }
}
