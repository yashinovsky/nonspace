import {
  AdditiveBlending,
  BufferAttribute,
  ClampToEdgeWrapping,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  type Matrix4,
} from 'three';
import type { Vec3 } from '../../core/math/vec3';
import type { Beam } from '../lines/BeamBatch';
import type { Palette } from '../palette';
import lightPointFrag from './lightPoint.frag';
import lightPointVert from './lightPoint.vert';
import { packPaths, type PackedPaths } from './path';
import trafficVert from './traffic.vert';

export const DEFAULT_POINT_SIZE = 1.5;
export const DEFAULT_POINT_INTENSITY = 1;
/** Pixel size is specified at this distance (world units). */
export const POINT_REF_DISTANCE = 80;
export const POINT_MIN_SIZE = 1.5;
export const POINT_MAX_SIZE = 128;
export const DEFAULT_POINT_FOG = 0.00035;

/** Lightpoints (plan §9.2). n = point count. */
export interface PointSet {
  /** [x, y, z] * n */
  positions: Float32Array;
  /** Beam index * n */
  color: Uint8Array;
  /** * n */
  intensity: Float32Array;
  /** px * n, default DEFAULT_POINT_SIZE (also the minimum on screen) */
  size?: Float32Array;
}

/** Mirrors BeamBatch for points. The plan only defines PointSet; this is owned by M1.2. */
export interface PointBatch {
  readonly capacity: number;
  setStatic(set: PointSet): void;
  beginDynamic(): void;
  push(p: Vec3, c: Beam, i?: number, size?: number): void;
  endDynamic(): void;
  transform: Matrix4;
  visible: boolean;
  dispose(): void;
}

/**
 * GPU extras on the real batch (plan §9.18). The §9.2 interface is unchanged;
 * `createRecordingPointBatch` stays a valid PointBatch.
 */
export interface GpuPointBatch extends PointBatch {
  readonly object: Mesh;
  readonly drawCount: number;
  setViewport(width: number, height: number): void;
  setTime(time: number): void;
  setFogDensity(density: number): void;
}

export interface PointBatchOptions {
  capacity: number;
  palette: Palette;
  fogDensity?: number;
  refDistance?: number;
  minSize?: number;
  maxSize?: number;
}

export interface TrafficInstanceSet {
  pathIndex: ArrayLike<number>;
  offset: ArrayLike<number>;
  speed: ArrayLike<number>;
  color: ArrayLike<number>;
  intensity?: ArrayLike<number>;
  size?: ArrayLike<number>;
  twinkle?: ArrayLike<number>;
}

export interface GpuTrafficBatch {
  readonly object: Mesh;
  readonly capacity: number;
  readonly drawCount: number;
  readonly packed: PackedPaths | null;
  setPaths(paths: readonly ArrayLike<number>[], closed?: boolean | readonly boolean[]): void;
  setInstances(set: TrafficInstanceSet): void;
  setViewport(width: number, height: number): void;
  setTime(time: number): void;
  setFogDensity(density: number): void;
  transform: Matrix4;
  visible: boolean;
  dispose(): void;
}

export function createPointSet(points: number, opts: { size?: boolean } = {}): PointSet {
  const set: PointSet = {
    positions: new Float32Array(points * 3),
    color: new Uint8Array(points),
    intensity: new Float32Array(points).fill(1),
  };
  if (opts.size) set.size = new Float32Array(points).fill(DEFAULT_POINT_SIZE);
  return set;
}

export function pointSetCount(set: PointSet): number {
  return set.color.length;
}

/** View of the first `cap` points. Uses `subarray` so it does not copy. */
export function clipPointSet(set: PointSet, cap: number): PointSet {
  const n = pointSetCount(set);
  const keep = cap < 0 ? 0 : cap < n ? cap | 0 : n;
  if (keep === n) return set;
  const out: PointSet = {
    positions: set.positions.subarray(0, keep * 3),
    color: set.color.subarray(0, keep),
    intensity: set.intensity.subarray(0, keep),
  };
  if (set.size) out.size = set.size.subarray(0, keep);
  return out;
}

export function projectPointSize(
  size: number,
  dist: number,
  refDistance = POINT_REF_DISTANCE,
  minSize = POINT_MIN_SIZE,
  maxSize = POINT_MAX_SIZE,
): { px: number; energy: number } {
  const d = Math.max(dist, 0.5);
  const projected = size * (refDistance / d);
  if (projected < minSize) {
    const r = projected / minSize;
    return { px: minSize, energy: r * r };
  }
  if (projected > maxSize) return { px: maxSize, energy: 1 };
  return { px: projected, energy: 1 };
}

function makeQuadGeometry(): InstancedBufferGeometry {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  );
  geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geo.instanceCount = 0;
  return geo;
}

function pointUniforms(
  palette: Palette,
  opts: { fogDensity: number; refDistance: number; minSize: number; maxSize: number },
): ShaderMaterial['uniforms'] {
  return {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uMinSize: { value: opts.minSize },
    uMaxSize: { value: opts.maxSize },
    uRefDistance: { value: opts.refDistance },
    uFogDensity: { value: opts.fogDensity },
    uPalette: palette.uniform,
  };
}

function createPointMaterial(
  vertexShader: string,
  palette: Palette,
  opts: { fogDensity: number; refDistance: number; minSize: number; maxSize: number },
  extra?: ShaderMaterial['uniforms'],
): ShaderMaterial {
  return new ShaderMaterial({
    name: 'lightPoint',
    vertexShader,
    fragmentShader: lightPointFrag,
    uniforms: { ...pointUniforms(palette, opts), ...extra },
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    lights: false,
  });
}

function bindMesh(geo: InstancedBufferGeometry, material: ShaderMaterial): Mesh {
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.name = 'PointBatch';
  return mesh;
}

export function createPointBatch(opts: PointBatchOptions): GpuPointBatch {
  const capacity = Math.max(1, opts.capacity | 0);
  const resolved = {
    fogDensity: opts.fogDensity ?? DEFAULT_POINT_FOG,
    refDistance: opts.refDistance ?? POINT_REF_DISTANCE,
    minSize: opts.minSize ?? POINT_MIN_SIZE,
    maxSize: opts.maxSize ?? POINT_MAX_SIZE,
  };

  const positions = new Float32Array(capacity * 3);
  const color = new Float32Array(capacity);
  const intensity = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const twinkle = new Float32Array(capacity);
  const phase = new Float32Array(capacity);

  const geo = makeQuadGeometry();
  const aPosition = new InstancedBufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const aColor = new InstancedBufferAttribute(color, 1).setUsage(DynamicDrawUsage);
  const aIntensity = new InstancedBufferAttribute(intensity, 1).setUsage(DynamicDrawUsage);
  const aSize = new InstancedBufferAttribute(size, 1).setUsage(DynamicDrawUsage);
  const aTwinkle = new InstancedBufferAttribute(twinkle, 1).setUsage(DynamicDrawUsage);
  const aPhase = new InstancedBufferAttribute(phase, 1).setUsage(DynamicDrawUsage);
  geo.setAttribute('aPosition', aPosition);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aIntensity', aIntensity);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aTwinkle', aTwinkle);
  geo.setAttribute('aPhase', aPhase);

  const material = createPointMaterial(lightPointVert, opts.palette, resolved);
  const mesh = bindMesh(geo, material);

  let staticCount = 0;
  let drawCount = 0;
  let dynWrite = 0;
  let disposed = false;

  const write = (
    i: number,
    x: number,
    y: number,
    z: number,
    c: number,
    inten: number,
    sz: number,
  ): void => {
    const p = i * 3;
    positions[p] = x;
    positions[p + 1] = y;
    positions[p + 2] = z;
    color[i] = c;
    intensity[i] = inten;
    size[i] = sz;
    twinkle[i] = 0;
    phase[i] = 0;
  };

  const upload = (from: number, count: number): void => {
    if (count <= 0) {
      geo.instanceCount = drawCount;
      return;
    }
    aPosition.addUpdateRange(from * 3, count * 3);
    aColor.addUpdateRange(from, count);
    aIntensity.addUpdateRange(from, count);
    aSize.addUpdateRange(from, count);
    aTwinkle.addUpdateRange(from, count);
    aPhase.addUpdateRange(from, count);
    aPosition.needsUpdate = true;
    aColor.needsUpdate = true;
    aIntensity.needsUpdate = true;
    aSize.needsUpdate = true;
    aTwinkle.needsUpdate = true;
    aPhase.needsUpdate = true;
    geo.instanceCount = drawCount;
  };

  const batch: GpuPointBatch = {
    capacity,
    object: mesh,
    get drawCount() {
      return drawCount;
    },
    transform: mesh.matrix,
    get visible() {
      return mesh.visible;
    },
    set visible(v) {
      mesh.visible = v;
    },
    setStatic(set) {
      const n = Math.min(pointSetCount(set), capacity);
      const sz = set.size;
      for (let i = 0; i < n; i++) {
        const p = i * 3;
        write(
          i,
          set.positions[p]!,
          set.positions[p + 1]!,
          set.positions[p + 2]!,
          set.color[i]!,
          set.intensity[i] ?? DEFAULT_POINT_INTENSITY,
          sz ? (sz[i] ?? DEFAULT_POINT_SIZE) : DEFAULT_POINT_SIZE,
        );
      }
      staticCount = n;
      drawCount = n;
      aPosition.needsUpdate = true;
      aColor.needsUpdate = true;
      aIntensity.needsUpdate = true;
      aSize.needsUpdate = true;
      aTwinkle.needsUpdate = true;
      aPhase.needsUpdate = true;
      geo.instanceCount = n;
    },
    beginDynamic() {
      dynWrite = staticCount;
    },
    push(p, c, i = DEFAULT_POINT_INTENSITY, sz = DEFAULT_POINT_SIZE) {
      if (dynWrite >= capacity) return;
      write(dynWrite, p.x, p.y, p.z, c, i, sz);
      dynWrite++;
    },
    endDynamic() {
      const from = staticCount;
      const count = dynWrite - staticCount;
      drawCount = dynWrite;
      upload(from, count);
    },
    setViewport(width, height) {
      (material.uniforms.uResolution!.value as Vector2).set(
        Math.max(1, width),
        Math.max(1, height),
      );
    },
    setTime(time) {
      material.uniforms.uTime!.value = time;
    },
    setFogDensity(density) {
      material.uniforms.uFogDensity!.value = density;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geo.dispose();
      material.dispose();
    },
  };

  return batch;
}

function makePathTexture(packed: PackedPaths | null): DataTexture {
  const width = packed?.width ?? 1;
  const height = packed?.height ?? 1;
  const data = packed?.data ?? new Float32Array(4);
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createTrafficBatch(opts: PointBatchOptions): GpuTrafficBatch {
  const capacity = Math.max(1, opts.capacity | 0);
  const resolved = {
    fogDensity: opts.fogDensity ?? DEFAULT_POINT_FOG,
    refDistance: opts.refDistance ?? POINT_REF_DISTANCE,
    minSize: opts.minSize ?? POINT_MIN_SIZE,
    maxSize: opts.maxSize ?? POINT_MAX_SIZE,
  };

  const pathStart = new Float32Array(capacity);
  const pathCount = new Float32Array(capacity);
  const pathLen = new Float32Array(capacity);
  const speed = new Float32Array(capacity);
  const color = new Float32Array(capacity);
  const intensity = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const twinkle = new Float32Array(capacity);
  const phase = new Float32Array(capacity);

  const geo = makeQuadGeometry();
  const attrs = {
    aPathStart: new InstancedBufferAttribute(pathStart, 1),
    aPathCount: new InstancedBufferAttribute(pathCount, 1),
    aPathLen: new InstancedBufferAttribute(pathLen, 1),
    aSpeed: new InstancedBufferAttribute(speed, 1),
    aColor: new InstancedBufferAttribute(color, 1),
    aIntensity: new InstancedBufferAttribute(intensity, 1),
    aSize: new InstancedBufferAttribute(size, 1),
    aTwinkle: new InstancedBufferAttribute(twinkle, 1),
    aPhase: new InstancedBufferAttribute(phase, 1),
  };
  for (const [name, attr] of Object.entries(attrs)) geo.setAttribute(name, attr);

  let pathTex = makePathTexture(null);
  const material = createPointMaterial(trafficVert, opts.palette, resolved, {
    uPathTex: { value: pathTex },
    uPathSize: { value: new Vector2(1, 1) },
  });
  material.name = 'trafficPoint';
  const mesh = bindMesh(geo, material);
  mesh.name = 'TrafficBatch';

  let packed: PackedPaths | null = null;
  let drawCount = 0;
  let disposed = false;

  const batch: GpuTrafficBatch = {
    capacity,
    object: mesh,
    get drawCount() {
      return drawCount;
    },
    get packed() {
      return packed;
    },
    transform: mesh.matrix,
    get visible() {
      return mesh.visible;
    },
    set visible(v) {
      mesh.visible = v;
    },
    setPaths(paths, closed = true) {
      packed = packPaths(paths, closed);
      pathTex.dispose();
      pathTex = makePathTexture(packed);
      material.uniforms.uPathTex!.value = pathTex;
      (material.uniforms.uPathSize!.value as Vector2).set(packed.width, packed.height);
    },
    setInstances(set) {
      if (!packed || packed.starts.length === 0) {
        drawCount = 0;
        geo.instanceCount = 0;
        return;
      }
      const n = Math.min(set.pathIndex.length, capacity);
      const nPaths = packed.starts.length;
      for (let i = 0; i < n; i++) {
        const pi = Math.min(nPaths - 1, Math.max(0, set.pathIndex[i]! | 0));
        pathStart[i] = packed.starts[pi]!;
        pathCount[i] = packed.counts[pi]!;
        pathLen[i] = packed.lengths[pi]!;
        speed[i] = set.speed[i] ?? 0;
        color[i] = set.color[i] ?? 0;
        intensity[i] = set.intensity?.[i] ?? DEFAULT_POINT_INTENSITY;
        size[i] = set.size?.[i] ?? DEFAULT_POINT_SIZE;
        twinkle[i] = set.twinkle?.[i] ?? 0;
        phase[i] = set.offset[i] ?? 0;
      }
      drawCount = n;
      for (const attr of Object.values(attrs)) attr.needsUpdate = true;
      geo.instanceCount = n;
    },
    setViewport(width, height) {
      (material.uniforms.uResolution!.value as Vector2).set(
        Math.max(1, width),
        Math.max(1, height),
      );
    },
    setTime(time) {
      material.uniforms.uTime!.value = time;
    },
    setFogDensity(density) {
      material.uniforms.uFogDensity!.value = density;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geo.dispose();
      material.dispose();
      pathTex.dispose();
    },
  };

  return batch;
}
