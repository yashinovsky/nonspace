/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  ShaderMaterial,
  StaticDrawUsage,
  Vector2,
  type BufferAttribute,
  type Camera,
  type Matrix4,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { Vec3 } from '../../core/math/vec3';
import type { Palette } from '../palette';
import beamLineVert from './beamLine.vert';
import beamLineFrag from './beamLine.frag';

/**
 * Beam palette indices (plan §5.3, §9.2). The plan writes a `const enum`; an
 * `as const` object is used instead because const enums don't survive
 * isolatedModules builds. Usage (`Beam.GRID`, `c: Beam`) is the same.
 */
export const Beam = {
  GRID: 0,
  AFTERGLOW: 1,
  MITSU: 2,
  TA: 3,
  ESFA: 4,
  AMBER: 5,
  ICE: 6,
  MIL: 7,
} as const;
export type Beam = (typeof Beam)[keyof typeof Beam];
export const BEAM_COUNT = 8;

/** Bits for `LineSet.flags` / `BeamBatch.push(..., f)`. */
export const BeamFlag = {
  DWELL: 1 << 0,
  KUANG: 1 << 1,
  NO_FOG: 1 << 2,
} as const;

export const DEFAULT_BEAM_WIDTH = 1.5;
export const DEFAULT_BEAM_INTENSITY = 1;

/** Gaussian σ in px (plan §8.5). Quad width is w + 3σ. */
export const BEAM_SIGMA = 0.75;
/** Extra vertex-dwell intensity when `BeamFlag.DWELL` is set. */
export const BEAM_DWELL = 1.35;
export const BEAM_DWELL_SIGMA = 2.4;
/** Fog: intensity *= exp(-density * max(dist - start, 0)). */
export const BEAM_FOG_START = 80;
export const BEAM_FOG_DENSITY = 0.00045;

/** Produced by the construct grammar, HUD and effects. n = segment count. */
export interface LineSet {
  /** [ax, ay, az, bx, by, bz] * n */
  positions: Float32Array;
  /** Beam index * n */
  color: Uint8Array;
  /** * n */
  intensity: Float32Array;
  /** px * n, default DEFAULT_BEAM_WIDTH */
  width?: Float32Array;
  /** BeamFlag bits * n */
  flags?: Uint8Array;
}

export interface BeamStyle {
  sigma: number;
  dwell: number;
  dwellSigma: number;
  fogStart: number;
  fogDensity: number;
}

export interface BeamBatch {
  readonly capacity: number;
  /** Upload once; replaces previous static contents. */
  setStatic(set: LineSet): void;
  /** Per-frame segments: beginDynamic, push..., endDynamic. Must not allocate. */
  beginDynamic(): void;
  push(a: Vec3, b: Vec3, c: Beam, i?: number, w?: number, f?: number): void;
  endDynamic(): void;
  /** Per-batch model matrix. */
  transform: Matrix4;
  visible: boolean;
  dispose(): void;
}

/**
 * GPU batch returned by `createBeamBatch`. `object` goes into a scene
 * (`renderer.scenes.matrix`). `style` is live uniforms.
 */
export interface BeamBatchGpu extends BeamBatch {
  readonly object: Group;
  readonly material: ShaderMaterial;
  readonly style: BeamStyle;
  readonly staticCount: number;
  readonly dynamicCount: number;
}

export interface LineSetOptions {
  width?: boolean;
  flags?: boolean;
}

export interface NearClip {
  /** Parameter of the clipped A along A→B. */
  tA: number;
  /** Parameter of the clipped B along A→B. */
  tB: number;
  visible: boolean;
}

export function createLineSet(segments: number, opts: LineSetOptions = {}): LineSet {
  const set: LineSet = {
    positions: new Float32Array(segments * 6),
    color: new Uint8Array(segments),
    intensity: new Float32Array(segments).fill(DEFAULT_BEAM_INTENSITY),
  };
  if (opts.width) set.width = new Float32Array(segments).fill(DEFAULT_BEAM_WIDTH);
  if (opts.flags) set.flags = new Uint8Array(segments);
  return set;
}

export function lineSetCount(set: LineSet): number {
  return set.color.length;
}

/**
 * View of the first `cap` segments. Uses `subarray` so it does not copy.
 * Callers that exceed the §8.7 line budget clip before `setStatic`.
 */
export function clipLineSet(set: LineSet, cap: number): LineSet {
  const n = lineSetCount(set);
  const keep = cap < 0 ? 0 : cap < n ? cap | 0 : n;
  if (keep === n) return set;
  const out: LineSet = {
    positions: set.positions.subarray(0, keep * 6),
    color: set.color.subarray(0, keep),
    intensity: set.intensity.subarray(0, keep),
  };
  if (set.width) out.width = set.width.subarray(0, keep);
  if (set.flags) out.flags = set.flags.subarray(0, keep);
  return out;
}

/** Split each segment into `parts` colinear pieces (Neuromancer softening). */
export function subdivideLineSet(set: LineSet, parts: number): LineSet {
  const n = Math.max(1, parts | 0);
  if (n === 1) return set;
  const segs = lineSetCount(set);
  const out = createLineSet(segs * n, { width: !!set.width, flags: !!set.flags });
  for (let i = 0; i < segs; i++) {
    const p = i * 6;
    const ax = set.positions[p]!;
    const ay = set.positions[p + 1]!;
    const az = set.positions[p + 2]!;
    const bx = set.positions[p + 3]!;
    const by = set.positions[p + 4]!;
    const bz = set.positions[p + 5]!;
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const o = (i * n + k) * 6;
      const j = i * n + k;
      out.positions[o] = ax + (bx - ax) * t0;
      out.positions[o + 1] = ay + (by - ay) * t0;
      out.positions[o + 2] = az + (bz - az) * t0;
      out.positions[o + 3] = ax + (bx - ax) * t1;
      out.positions[o + 4] = ay + (by - ay) * t1;
      out.positions[o + 5] = az + (bz - az) * t1;
      out.color[j] = set.color[i]!;
      out.intensity[j] = set.intensity[i]!;
      if (out.width && set.width) out.width[j] = set.width[i]!;
      if (out.flags && set.flags) out.flags[j] = set.flags[i]!;
    }
  }
  return out;
}

const DEFAULT_QUAD = new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]);
const DEFAULT_INDEX = [0, 1, 2, 1, 3, 2];

/** Shared Neuromancer soften uniforms. Amount 0 is off (default boot). */
export const BEAM_SOFTEN = {
  amount: { value: 0 },
  time: { value: 0 },
};

export const BEAM_SOFTEN_DIVISIONS = 8;

const beamGeos = new Set<InstancedBufferGeometry>();
let beamAlongSteps = 1;

function alongGeometry(steps: number): { positions: Float32Array; index: number[] } {
  if (steps <= 1) return { positions: DEFAULT_QUAD, index: DEFAULT_INDEX };
  const n = steps + 1;
  const positions = new Float32Array(n * 2 * 3);
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / steps;
    const b = i * 2;
    positions[b * 3] = t;
    positions[b * 3 + 1] = -1;
    positions[(b + 1) * 3] = t;
    positions[(b + 1) * 3 + 1] = 1;
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions, index };
}

function applyAlongSteps(geo: InstancedBufferGeometry, steps: number): void {
  const { positions, index } = alongGeometry(steps);
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
}

/**
 * Neuromancer softening. `amount` 0 restores the 1-quad template (no leftover).
 * Template subdivision is applied only while amount > 0.
 */
export function setBeamSoften(amount: number, time?: number): void {
  const a = Math.min(1, Math.max(0, amount));
  BEAM_SOFTEN.amount.value = a;
  if (time !== undefined) BEAM_SOFTEN.time.value = time;
  const steps = a > 1e-4 ? BEAM_SOFTEN_DIVISIONS : 1;
  if (steps === beamAlongSteps) return;
  beamAlongSteps = steps;
  for (const geo of beamGeos) applyAlongSteps(geo, steps);
}

export function getBeamSoften(): number {
  return BEAM_SOFTEN.amount.value;
}

/**
 * Clip a view-space segment to the near plane (plan §8.5).
 * `za`/`zb` are Three.js view-space z (negative in front). `near` is
 * `camera.near` > 0. Uses positive depth `d = -z`, then
 * `t = (near - da) / (db - da)`.
 */
export function clipSegmentNear(za: number, zb: number, near: number): NearClip {
  const da = -za;
  const db = -zb;
  if (da < near && db < near) return { tA: 0, tB: 1, visible: false };
  let tA = 0;
  let tB = 1;
  if (da < near) tA = (near - da) / (db - da);
  if (db < near) tB = (near - da) / (db - da);
  return { tA, tB, visible: true };
}

/**
 * If projected width is below 1 px, clamp to 1 px and scale intensity by the
 * ratio so sub-pixel lines dim instead of shimmering (plan §8.5).
 */
export function conserveWidth(widthPx: number): { width: number; intensityScale: number } {
  const w = Math.max(0, widthPx);
  if (w >= 1) return { width: w, intensityScale: 1 };
  return { width: 1, intensityScale: w };
}

export function fogFactor(dist: number, start: number, density: number): number {
  if (density <= 0) return 1;
  return Math.exp(-density * Math.max(dist - start, 0));
}

interface GpuBuffers {
  geo: InstancedBufferGeometry;
  aA: InstancedBufferAttribute;
  aB: InstancedBufferAttribute;
  aData: InstancedBufferAttribute;
  mesh: Mesh;
  capacity: number;
}

function makeQuadGeometry(
  capacity: number,
  usage: typeof DynamicDrawUsage | typeof StaticDrawUsage,
): GpuBuffers {
  const geo = new InstancedBufferGeometry();
  applyAlongSteps(geo, beamAlongSteps);
  beamGeos.add(geo);

  const aA = new InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3);
  aA.setUsage(usage);
  const aB = new InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3);
  aB.setUsage(usage);
  const aData = new InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 4), 4);
  aData.setUsage(usage);
  geo.setAttribute('aA', aA);
  geo.setAttribute('aB', aB);
  geo.setAttribute('aData', aData);
  geo.instanceCount = 0;

  const mesh = new Mesh(geo);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { geo, aA, aB, aData, mesh, capacity: Math.max(capacity, 1) };
}

function writeSegment(
  aA: Float32Array,
  aB: Float32Array,
  aData: Float32Array,
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  c: number,
  intensity: number,
  w: number,
  f: number,
): void {
  const i3 = i * 3;
  const i4 = i * 4;
  aA[i3] = ax;
  aA[i3 + 1] = ay;
  aA[i3 + 2] = az;
  aB[i3] = bx;
  aB[i3 + 1] = by;
  aB[i3 + 2] = bz;
  aData[i4] = c;
  aData[i4 + 1] = intensity;
  aData[i4 + 2] = w;
  aData[i4 + 3] = f;
}

function uploadCount(buf: GpuBuffers, count: number): void {
  buf.geo.instanceCount = count;
  buf.mesh.visible = count > 0;
  if (count <= 0) return;
  const mark = (attr: InstancedBufferAttribute, stride: number): void => {
    attr.addUpdateRange(0, count * stride);
    attr.needsUpdate = true;
  };
  mark(buf.aA, 3);
  mark(buf.aB, 3);
  mark(buf.aData, 4);
}

export function createBeamMaterial(palette: Palette, style?: Partial<BeamStyle>): ShaderMaterial {
  const resolved: BeamStyle = {
    sigma: style?.sigma ?? BEAM_SIGMA,
    dwell: style?.dwell ?? BEAM_DWELL,
    dwellSigma: style?.dwellSigma ?? BEAM_DWELL_SIGMA,
    fogStart: style?.fogStart ?? BEAM_FOG_START,
    fogDensity: style?.fogDensity ?? BEAM_FOG_DENSITY,
  };
  return new ShaderMaterial({
    name: 'beamLine',
    glslVersion: GLSL3,
    vertexShader: beamLineVert,
    fragmentShader: beamLineFrag,
    uniforms: {
      uPalette: palette.uniform,
      uResolution: { value: new Vector2(1, 1) },
      uNear: { value: 0.5 },
      uSigma: { value: resolved.sigma },
      uDwell: { value: resolved.dwell },
      uDwellSigma: { value: resolved.dwellSigma },
      uFogStart: { value: resolved.fogStart },
      uFogDensity: { value: resolved.fogDensity },
      uSoften: BEAM_SOFTEN.amount,
      uSoftenTime: BEAM_SOFTEN.time,
      logDepthBufFC: { value: 2 / (Math.log(1000 + 1) / Math.LN2) },
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
}

export interface CreateBeamBatchOptions {
  /** Dynamic `push` capacity. Static `setStatic` may be larger (reallocates). */
  capacity?: number;
  style?: Partial<BeamStyle>;
  /** Share a material across batches (same palette + style uniforms). */
  material?: ShaderMaterial;
}

export function createBeamBatch(palette: Palette, opts: CreateBeamBatchOptions = {}): BeamBatchGpu {
  const capacity = Math.max(1, opts.capacity ?? 4096);
  const material = opts.material ?? createBeamMaterial(palette, opts.style);
  const group = new Group();
  group.matrixAutoUpdate = false;
  group.name = 'BeamBatch';

  let staticBuf = makeQuadGeometry(1, StaticDrawUsage);
  staticBuf.mesh.material = material;
  group.add(staticBuf.mesh);

  const dynBuf = makeQuadGeometry(capacity, DynamicDrawUsage);
  dynBuf.mesh.material = material;
  group.add(dynBuf.mesh);

  let dynCount = 0;
  let staticCount = 0;
  let drawing = false;

  const style: BeamStyle = {
    get sigma() {
      return material.uniforms.uSigma!.value as number;
    },
    set sigma(v) {
      material.uniforms.uSigma!.value = v;
    },
    get dwell() {
      return material.uniforms.uDwell!.value as number;
    },
    set dwell(v) {
      material.uniforms.uDwell!.value = v;
    },
    get dwellSigma() {
      return material.uniforms.uDwellSigma!.value as number;
    },
    set dwellSigma(v) {
      material.uniforms.uDwellSigma!.value = v;
    },
    get fogStart() {
      return material.uniforms.uFogStart!.value as number;
    },
    set fogStart(v) {
      material.uniforms.uFogStart!.value = v;
    },
    get fogDensity() {
      return material.uniforms.uFogDensity!.value as number;
    },
    set fogDensity(v) {
      material.uniforms.uFogDensity!.value = v;
    },
  };

  const syncFrame = (renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
    const rt = renderer.getRenderTarget();
    const w = rt?.width ?? renderer.domElement.width;
    const h = rt?.height ?? renderer.domElement.height;
    (material.uniforms.uResolution!.value as Vector2).set(w, h);
    const persp = camera as PerspectiveCamera;
    const near = persp.near ?? 0.5;
    const far = persp.far ?? 1000;
    material.uniforms.uNear!.value = near;
    material.uniforms.logDepthBufFC!.value = 2 / (Math.log(far + 1) / Math.LN2);
    group.matrixWorldNeedsUpdate = true;
  };
  staticBuf.mesh.onBeforeRender = syncFrame;
  dynBuf.mesh.onBeforeRender = syncFrame;

  const dynA = dynBuf.aA.array as Float32Array;
  const dynB = dynBuf.aB.array as Float32Array;
  const dynData = dynBuf.aData.array as Float32Array;

  const batch: BeamBatchGpu = {
    capacity,
    object: group,
    material,
    style,
    transform: group.matrix,
    get visible() {
      return group.visible;
    },
    set visible(v) {
      group.visible = v;
    },
    get staticCount() {
      return staticCount;
    },
    get dynamicCount() {
      return dynCount;
    },
    setStatic(set) {
      const n = lineSetCount(set);
      if (n > staticBuf.capacity) {
        group.remove(staticBuf.mesh);
        beamGeos.delete(staticBuf.geo);
        staticBuf.geo.dispose();
        staticBuf = makeQuadGeometry(n, StaticDrawUsage);
        staticBuf.mesh.material = material;
        staticBuf.mesh.onBeforeRender = syncFrame;
        group.add(staticBuf.mesh);
      }
      const aA = staticBuf.aA.array as Float32Array;
      const aB = staticBuf.aB.array as Float32Array;
      const aData = staticBuf.aData.array as Float32Array;
      const pos = set.positions;
      for (let i = 0; i < n; i++) {
        const p = i * 6;
        writeSegment(
          aA,
          aB,
          aData,
          i,
          pos[p]!,
          pos[p + 1]!,
          pos[p + 2]!,
          pos[p + 3]!,
          pos[p + 4]!,
          pos[p + 5]!,
          set.color[i]!,
          set.intensity[i]!,
          set.width?.[i] ?? DEFAULT_BEAM_WIDTH,
          set.flags?.[i] ?? 0,
        );
      }
      staticCount = n;
      (staticBuf.aA as BufferAttribute).needsUpdate = true;
      (staticBuf.aB as BufferAttribute).needsUpdate = true;
      (staticBuf.aData as BufferAttribute).needsUpdate = true;
      staticBuf.geo.instanceCount = n;
      staticBuf.mesh.visible = n > 0;
    },
    beginDynamic() {
      dynCount = 0;
      drawing = true;
    },
    push(a, b, c, i = DEFAULT_BEAM_INTENSITY, w = DEFAULT_BEAM_WIDTH, f = 0) {
      if (!drawing || dynCount >= capacity) return;
      writeSegment(dynA, dynB, dynData, dynCount, a.x, a.y, a.z, b.x, b.y, b.z, c, i, w, f);
      dynCount++;
    },
    endDynamic() {
      drawing = false;
      uploadCount(dynBuf, dynCount);
    },
    dispose() {
      group.remove(staticBuf.mesh);
      group.remove(dynBuf.mesh);
      beamGeos.delete(staticBuf.geo);
      beamGeos.delete(dynBuf.geo);
      staticBuf.geo.dispose();
      dynBuf.geo.dispose();
      if (!opts.material) material.dispose();
    },
  };
  return batch;
}
