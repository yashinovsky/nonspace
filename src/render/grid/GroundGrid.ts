/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  GLSL3,
  Matrix4,
  Mesh,
  OneFactor,
  ShaderMaterial,
  Vector2,
  Vector4,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { Palette } from '../palette';
import groundGridVert from './groundGrid.vert';
import groundGridFrag from './groundGrid.frag';

/** Minor / major / super periods in world units (plan §5.5, §8.6). */
export const GRID_MINOR = 8;
export const GRID_MAJOR = 64;
export const GRID_SUPER = 1024;

/** Pixel widths per level (pristine-grid AA). */
export const GRID_MINOR_WIDTH = 1.0;
export const GRID_MAJOR_WIDTH = 1.6;
export const GRID_SUPER_WIDTH = 2.4;

/** Emissive weights per level. */
export const GRID_MINOR_I = 0.28;
export const GRID_MAJOR_I = 0.65;
export const GRID_SUPER_I = 1.15;

/** Alternating cell fill near the camera (plan §5.5). */
export const CHECKER_INTENSITY = 0.02;
export const CHECKER_FADE_END = 220;

/** Distance fade to black — no horizon glow. */
export const GRID_FOG_START = 120;
export const GRID_FOG_DENSITY = 0.00018;

export const WARP_COUNT = 4;

export interface WarpPoint {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

export const ZERO_WARP: WarpPoint = { x: 0, z: 0, radius: 1, strength: 0 };

export interface GroundGrid {
  readonly object: Mesh;
  readonly material: ShaderMaterial;
  setWarp(points: readonly WarpPoint[]): void;
  getWarp(): WarpPoint[];
  /** Race-out radius in world units. `>= 1e8` (default) is infinite. */
  setRadius(radius: number): void;
  get radius(): number;
  follow(camera: { x: number; z: number }): void;
  dispose(): void;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** GLSL `fract` (including negatives). */
export function fract(v: number): number {
  return v - Math.floor(v);
}

/**
 * Screen-space density fade (plan §8.5). `deriv` is fwidth of the cell
 * coordinate (world / period). Lines vanish before they alias.
 */
export function densityFade(deriv: number): number {
  return 1 - smoothstep(0.25, 0.75, deriv);
}

/** 0 at integers of `coord`, 0.5 at cell centres. */
export function distToLineInCells(coord: number): number {
  return Math.abs(fract(coord - 0.5) - 0.5);
}

/** CPU twin of `pristineLine` in groundGrid.frag. */
export function pristineLine(coord: number, deriv: number, widthPx: number): number {
  const der = Math.max(deriv, 1e-8);
  const d = distToLineInCells(coord);
  const half = 0.5 * widthPx * der;
  const line = 1 - smoothstep(half, half + der, d);
  return line * densityFade(der);
}

export function gridDistanceFade(
  dist: number,
  start = GRID_FOG_START,
  density = GRID_FOG_DENSITY,
): number {
  return Math.exp(-density * Math.max(dist - start, 0));
}

export function checkerCell(x: number, z: number, period = GRID_MINOR): number {
  const ix = Math.floor(x / period);
  const iz = Math.floor(z / period);
  return ((ix + iz) & 1) === 0 ? 0 : 1;
}

export function checkerNearFade(dist: number, end = CHECKER_FADE_END): number {
  if (dist >= end) return 0;
  if (dist <= 0) return 1;
  const t = dist / end;
  return 1 - t * t;
}

/** Jack-in grid race-out (plan §5.9). Infinite when radius ≥ 1e8. */
export function gridRadiusFade(dist: number, radius: number): number {
  if (!(radius > 0) || radius >= 1e8) return 1;
  const edge = radius * 0.82;
  if (dist <= edge) return 1;
  if (dist >= radius) return 0;
  const t = (dist - edge) / (radius - edge);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Wintermute warp field (plan §8.5). Each control point is (xz, radius,
 * strength). Positive strength pushes grid coordinates outward; negative
 * pulls them in. Same math as `applyWarp` in groundGrid.frag.
 */
export function warpXZ(
  x: number,
  z: number,
  points: readonly WarpPoint[],
): { x: number; z: number } {
  let wx = x;
  let wz = z;
  const n = Math.min(points.length, WARP_COUNT);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    if (p.strength === 0 || p.radius <= 0) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-4) continue;
    const gauss = Math.exp((-r * r) / (2 * p.radius * p.radius));
    const s = p.strength * p.radius * gauss;
    wx += (dx / r) * s;
    wz += (dz / r) * s;
  }
  return { x: wx, z: wz };
}

export function emptyWarp(): WarpPoint[] {
  return [{ ...ZERO_WARP }, { ...ZERO_WARP }, { ...ZERO_WARP }, { ...ZERO_WARP }];
}

function logDepthFC(far: number): number {
  return 2 / (Math.log(far + 1) / Math.LN2);
}

export function createGroundGrid(palette: Palette): GroundGrid {
  const warpVecs = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];
  for (const v of warpVecs) v.set(0, 0, 1, 0);
  const viewProjInv = new Matrix4();
  const resolution = new Vector2(1, 1);

  const material = new ShaderMaterial({
    name: 'groundGrid',
    glslVersion: GLSL3,
    vertexShader: groundGridVert,
    fragmentShader: groundGridFrag,
    uniforms: {
      uPalette: palette.uniform,
      uWarp: { value: warpVecs },
      uViewProjInverse: { value: viewProjInv },
      uResolution: { value: resolution },
      uNear: { value: 0.5 },
      uMinor: { value: GRID_MINOR },
      uMajor: { value: GRID_MAJOR },
      uSuper: { value: GRID_SUPER },
      uMinorWidth: { value: GRID_MINOR_WIDTH },
      uMajorWidth: { value: GRID_MAJOR_WIDTH },
      uSuperWidth: { value: GRID_SUPER_WIDTH },
      uMinorI: { value: GRID_MINOR_I },
      uMajorI: { value: GRID_MAJOR_I },
      uSuperI: { value: GRID_SUPER_I },
      uChecker: { value: CHECKER_INTENSITY },
      uCheckerEnd: { value: CHECKER_FADE_END },
      uFogStart: { value: GRID_FOG_START },
      uFogDensity: { value: GRID_FOG_DENSITY },
      uRadius: { value: 1e9 },
      logDepthBufFC: { value: logDepthFC(60_000) },
    },
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    fog: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );

  const mesh = new Mesh(geometry, material);
  mesh.name = 'GroundGrid';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 0;

  const syncFrame = (renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
    const persp = camera as PerspectiveCamera;
    persp.updateMatrixWorld();
    viewProjInv.multiplyMatrices(persp.projectionMatrix, persp.matrixWorldInverse).invert();
    const rt = renderer.getRenderTarget();
    resolution.set(
      rt?.width ?? renderer.domElement.width,
      rt?.height ?? renderer.domElement.height,
    );
    material.uniforms.uNear!.value = persp.near ?? 0.5;
    material.uniforms.logDepthBufFC!.value = logDepthFC(persp.far ?? 60_000);
  };
  mesh.onBeforeRender = syncFrame;

  const stored = emptyWarp();
  let radius = 1e9;

  const grid: GroundGrid = {
    object: mesh,
    material,
    setWarp(points) {
      for (let i = 0; i < WARP_COUNT; i++) {
        const p = points[i] ?? ZERO_WARP;
        stored[i] = { x: p.x, z: p.z, radius: p.radius, strength: p.strength };
        warpVecs[i]!.set(p.x, p.z, p.radius, p.strength);
      }
    },
    getWarp() {
      return stored.map((p) => ({ ...p }));
    },
    setRadius(next) {
      radius = next > 0 ? next : 1e9;
      material.uniforms.uRadius!.value = radius;
    },
    get radius() {
      return radius;
    },
    follow(_camera) {
      // Infinite via ray-plane; nothing to snap.
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return grid;
}
