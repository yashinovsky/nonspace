/**
 * Dev route `?lab=points` (M1.2). 60k static lightpoints in one draw, plus
 * traffic particles sliding along Manhattan polylines (path DataTexture).
 */

import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import { pcg32 } from '../core/rng';
import { Beam } from '../render/lines/BeamBatch';
import {
  createPointBatch,
  createPointSet,
  createTrafficBatch,
  POINT_MIN_SIZE,
  type GpuPointBatch,
  type GpuTrafficBatch,
} from '../render/points/PointBatch';
import { maxJointError } from '../render/points/path';
import type { Renderer } from '../render/Renderer';

export const LAB_STATIC_POINTS = 60_000;
export const LAB_TRAFFIC_POINTS = 2_400;

export interface PointsLab {
  update(dt: number): void;
  dispose(): void;
  readonly staticBatch: GpuPointBatch;
  readonly trafficBatch: GpuTrafficBatch;
  readonly jointError: number;
}

const CSS = [
  'position:fixed',
  'left:1rem',
  'top:1rem',
  'z-index:20',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'background:rgba(0,0,0,0.55)',
  'padding:0.75rem 0.9rem 0.85rem',
  'border:1px solid #1a3348',
  'white-space:pre',
].join(';');

function manhattanLoop(cx: number, cz: number, w: number, d: number, y: number): Float32Array {
  return new Float32Array([
    cx - w,
    y,
    cz - d,
    cx + w,
    y,
    cz - d,
    cx + w,
    y,
    cz + d,
    cx - w,
    y,
    cz + d,
    cx - w,
    y,
    cz - d,
  ]);
}

function manhattanL(x0: number, z0: number, x1: number, z1: number, y: number): Float32Array {
  return new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, x0, y, z0]);
}

function makeGuideGrid(): LineSegments {
  const pos: number[] = [];
  const y = 0;
  const half = 160;
  const step = 32;
  for (let i = -half; i <= half; i += step) {
    pos.push(-half, y, i, half, y, i);
    pos.push(i, y, -half, i, y, half);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new LineBasicMaterial({
    color: 0x14304a,
    toneMapped: false,
    transparent: true,
    opacity: 0.45,
  });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'pointsLabGrid';
  return lines;
}

function fillConstellation(set: ReturnType<typeof createPointSet>, sizes: Float32Array): void {
  const rng = pcg32(0x6e05_1a2b, 1);
  const clusters: Array<{ x: number; z: number; y: number; s: number; color: Beam; n: number }> = [
    { x: 0, z: -70, y: 8, s: 55, color: Beam.GRID, n: 14000 },
    { x: 90, z: -30, y: 14, s: 38, color: Beam.MITSU, n: 9000 },
    { x: -85, z: -50, y: 10, s: 42, color: Beam.AMBER, n: 8000 },
    { x: 40, z: -140, y: 22, s: 50, color: Beam.TA, n: 7000 },
    { x: -40, z: -180, y: 18, s: 36, color: Beam.ICE, n: 6000 },
    { x: 130, z: -110, y: 30, s: 28, color: Beam.ESFA, n: 5000 },
    { x: -120, z: -120, y: 16, s: 32, color: Beam.MIL, n: 4000 },
  ];
  let i = 0;
  for (const c of clusters) {
    for (let k = 0; k < c.n && i < LAB_STATIC_POINTS; k++, i++) {
      const p = i * 3;
      set.positions[p] = c.x + rng.normal(0, c.s * 0.35);
      set.positions[p + 1] = Math.max(0.4, c.y + rng.normal(0, c.s * 0.12));
      set.positions[p + 2] = c.z + rng.normal(0, c.s * 0.45);
      set.color[i] = c.color;
      set.intensity[i] = rng.float(0.45, 1.8);
      sizes[i] = rng.float(1.5, 4.2);
    }
  }
  // Receding lane: far points clamp to 1.5 px.
  const lane = Math.min(80, LAB_STATIC_POINTS - i);
  for (let k = 0; k < lane; k++, i++) {
    const p = i * 3;
    const t = k / Math.max(lane - 1, 1);
    set.positions[p] = -95;
    set.positions[p + 1] = 10;
    set.positions[p + 2] = -20 - t * 4800;
    set.color[i] = Beam.GRID;
    set.intensity[i] = 1.2;
    sizes[i] = POINT_MIN_SIZE;
  }
  while (i < LAB_STATIC_POINTS) {
    const p = i * 3;
    set.positions[p] = rng.float(-400, 400);
    set.positions[p + 1] = rng.float(2, 80);
    set.positions[p + 2] = rng.float(-900, 80);
    set.color[i] = rng.pick([Beam.GRID, Beam.ICE, Beam.MIL, Beam.AMBER]);
    set.intensity[i] = rng.float(0.3, 1.1);
    sizes[i] = rng.float(1.5, 2.4);
    i++;
  }
}

export function installPointsLab(renderer: Renderer, root: HTMLElement): PointsLab {
  const palette = renderer.palette;
  const staticBatch = createPointBatch({ capacity: LAB_STATIC_POINTS, palette });
  const trafficBatch = createTrafficBatch({ capacity: LAB_TRAFFIC_POINTS, palette });

  const set = createPointSet(LAB_STATIC_POINTS, { size: true });
  const sizes = set.size ?? new Float32Array(LAB_STATIC_POINTS).fill(POINT_MIN_SIZE);
  set.size = sizes;
  fillConstellation(set, sizes);
  staticBatch.setStatic(set);

  const paths = [
    manhattanLoop(0, -40, 70, 36, 1.6),
    manhattanLoop(80, -90, 40, 28, 1.6),
    manhattanLoop(-70, -100, 48, 22, 1.6),
    manhattanL(-20, 20, 110, -60, 1.6),
    manhattanL(30, -160, -90, -40, 8.0),
    manhattanLoop(0, -200, 90, 40, 18.0),
  ];
  trafficBatch.setPaths(paths, true);

  const rng = pcg32(0x71af, 2);
  const n = LAB_TRAFFIC_POINTS;
  const pathIndex = new Uint16Array(n);
  const offset = new Float32Array(n);
  const speed = new Float32Array(n);
  const color = new Uint8Array(n);
  const intensity = new Float32Array(n);
  const size = new Float32Array(n);
  const twinkle = new Float32Array(n);
  const hues = [Beam.AMBER, Beam.MITSU, Beam.ESFA, Beam.GRID, Beam.TA, Beam.ICE];
  for (let i = 0; i < n; i++) {
    pathIndex[i] = rng.below(paths.length);
    offset[i] = rng.next();
    speed[i] = rng.float(14, 42);
    color[i] = hues[pathIndex[i] % hues.length]!;
    intensity[i] = rng.float(0.9, 2.4);
    size[i] = rng.float(1.6, 3.2);
    twinkle[i] = rng.float(0.15, 0.55);
  }
  trafficBatch.setInstances({ pathIndex, offset, speed, color, intensity, size, twinkle });

  const jointError = trafficBatch.packed ? maxJointError(trafficBatch.packed) : 0;

  const grid = makeGuideGrid();
  renderer.scenes.matrix.add(grid);
  renderer.scenes.matrix.add(staticBatch.object);
  renderer.scenes.matrix.add(trafficBatch.object);

  const cam = renderer.cameras.matrix;
  cam.near = 0.5;
  cam.far = 60_000;
  cam.fov = 75;
  cam.position.set(36, 26, 96);
  cam.lookAt(16, 8, -70);
  cam.updateProjectionMatrix();

  staticBatch.setViewport(renderer.internalWidth, renderer.internalHeight);
  trafficBatch.setViewport(renderer.internalWidth, renderer.internalHeight);

  const panel = document.createElement('div');
  panel.style.cssText = CSS;
  panel.dataset.testid = 'points-lab';
  root.appendChild(panel);

  root.dataset.pointCount = String(staticBatch.drawCount);
  root.dataset.pointDraws = '1';
  root.dataset.trafficCount = String(trafficBatch.drawCount);
  root.dataset.jointError = jointError.toExponential(3);
  root.dataset.minSize = String(POINT_MIN_SIZE);

  let time = 0;
  const lookX = 16;
  const lookY = 8;
  const lookZ = -70;

  const syncHud = (): void => {
    panel.textContent = [
      'M1.2 lightpoints',
      `static  ${staticBatch.drawCount}  (1 draw)`,
      `traffic ${trafficBatch.drawCount}  (path tex)`,
      `joint ε ${jointError.toExponential(2)}`,
      `min px  ${POINT_MIN_SIZE}`,
    ].join('\n');
  };
  syncHud();

  return {
    staticBatch,
    trafficBatch,
    jointError,
    update(dt) {
      time += dt;
      cam.position.x = 36 + Math.sin(time * 0.07) * 14;
      cam.position.z = 96 + Math.cos(time * 0.07) * 10;
      cam.lookAt(lookX, lookY, lookZ);
      staticBatch.setViewport(renderer.internalWidth, renderer.internalHeight);
      trafficBatch.setViewport(renderer.internalWidth, renderer.internalHeight);
      staticBatch.setTime(time);
      trafficBatch.setTime(time);
    },
    dispose() {
      renderer.scenes.matrix.remove(grid);
      renderer.scenes.matrix.remove(staticBatch.object);
      renderer.scenes.matrix.remove(trafficBatch.object);
      grid.geometry.dispose();
      (grid.material as LineBasicMaterial).dispose();
      staticBatch.dispose();
      trafficBatch.dispose();
      panel.remove();
    },
  };
}
