/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  GLSL3,
  Mesh,
  OneFactor,
  ShaderMaterial,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { vec3, type Vec3 } from '../../core/math/vec3';
import {
  BeamFlag,
  createLineSet,
  DEFAULT_BEAM_WIDTH,
  type Beam,
  type LineSet,
} from '../lines/BeamBatch';
import type { IceDef } from '../../breach/IceModel';
import iceFacetFrag from './iceFacet.frag';
import iceFacetVert from './iceFacet.vert';
import { classLook } from './iceFacetMath';

function logDepthFC(far: number): number {
  return 2 / (Math.log(far + 1) / Math.LN2);
}

export interface IceFaceInfo {
  center: Vec3;
  normal: Vec3;
  tangent: Vec3;
  bitangent: Vec3;
  size: number;
}

export interface IceShellGeom {
  geometry: BufferGeometry;
  lines: LineSet;
  faces: IceFaceInfo[];
}

export interface IceFacetMaterial {
  readonly material: ShaderMaterial;
  setColor(rgb: { r: number; g: number; b: number }): void;
  setDensity(density: number, width: number): void;
  setAngles(a: number, b: number): void;
  setActiveFace(index: number): void;
  setFlicker(amount: number): void;
  setTime(t: number): void;
  setIntensity(i: number): void;
  dispose(): void;
}

export function createIceFacetMaterial(
  color: { r: number; g: number; b: number },
  density: number,
  width: number,
  intensity: number,
): IceFacetMaterial {
  const material = new ShaderMaterial({
    name: 'iceFacet',
    glslVersion: GLSL3,
    vertexShader: iceFacetVert,
    fragmentShader: iceFacetFrag,
    uniforms: {
      logDepthBufFC: { value: logDepthFC(60_000) },
      uColor: { value: new Vector3(color.r, color.g, color.b) },
      uIntensity: { value: intensity },
      uDensity: { value: density },
      uAngleA: { value: 0.22 },
      uAngleB: { value: 0.22 + 0.21 },
      uWidth: { value: width },
      uActiveFace: { value: 0 },
      uFlicker: { value: 0 },
      uTime: { value: 0 },
    },
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    fog: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });

  const sync = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
    const persp = camera as PerspectiveCamera;
    material.uniforms.logDepthBufFC!.value = logDepthFC(persp.far ?? 60_000);
  };
  material.userData.syncFrame = sync;

  return {
    material,
    setColor(rgb) {
      (material.uniforms.uColor!.value as Vector3).set(rgb.r, rgb.g, rgb.b);
    },
    setDensity(d, w) {
      material.uniforms.uDensity!.value = d;
      material.uniforms.uWidth!.value = w;
    },
    setAngles(a, b) {
      material.uniforms.uAngleA!.value = a;
      material.uniforms.uAngleB!.value = b;
    },
    setActiveFace(index) {
      material.uniforms.uActiveFace!.value = index;
    },
    setFlicker(amount) {
      material.uniforms.uFlicker!.value = amount;
    },
    setTime(t) {
      material.uniforms.uTime!.value = t;
    },
    setIntensity(i) {
      material.uniforms.uIntensity!.value = i;
    },
    dispose() {
      material.dispose();
    },
  };
}

type Vert = readonly [number, number, number];
type Face = readonly number[];

function orthonormal(normal: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const up = Math.abs(normal.y) < 0.92 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const tx = up.y * normal.z - up.z * normal.y;
  const ty = up.z * normal.x - up.x * normal.z;
  const tz = up.x * normal.y - up.y * normal.x;
  const tlen = Math.hypot(tx, ty, tz) || 1;
  const tangent = vec3(tx / tlen, ty / tlen, tz / tlen);
  const bitangent = vec3(
    normal.y * tangent.z - normal.z * tangent.y,
    normal.z * tangent.x - normal.x * tangent.z,
    normal.x * tangent.y - normal.y * tangent.x,
  );
  return { tangent, bitangent };
}

function scaleUnit(v: Vert, r: number): Vert {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [(v[0] / len) * r, (v[1] / len) * r, (v[2] / len) * r];
}

function cubeMesh(r: number): { verts: Vert[]; faces: Face[] } {
  const s = r;
  const verts: Vert[] = [
    [-s, -s, -s],
    [s, -s, -s],
    [s, s, -s],
    [-s, s, -s],
    [-s, -s, s],
    [s, -s, s],
    [s, s, s],
    [-s, s, s],
  ];
  const faces: Face[] = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ];
  return { verts, faces };
}

function slabMesh(r: number): { verts: Vert[]; faces: Face[] } {
  const hx = r * 1.15;
  const hy = r * 0.28;
  const hz = r * 0.7;
  const verts: Vert[] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];
  return { verts, faces: cubeMesh(1).faces };
}

function octaMesh(r: number): { verts: Vert[]; faces: Face[] } {
  const verts: Vert[] = [
    scaleUnit([1, 0, 0], r),
    scaleUnit([-1, 0, 0], r),
    scaleUnit([0, 1, 0], r),
    scaleUnit([0, -1, 0], r),
    scaleUnit([0, 0, 1], r),
    scaleUnit([0, 0, -1], r),
  ];
  const faces: Face[] = [
    [2, 0, 4],
    [2, 4, 1],
    [2, 1, 5],
    [2, 5, 0],
    [3, 4, 0],
    [3, 1, 4],
    [3, 5, 1],
    [3, 0, 5],
  ];
  return { verts, faces };
}

function icosaMesh(r: number): { verts: Vert[]; faces: Face[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vert[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  const verts = raw.map((v) => scaleUnit(v, r));
  const faces: Face[] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return { verts, faces };
}

export function shellMesh(kind: IceDef['shell'], radius: number): { verts: Vert[]; faces: Face[] } {
  if (kind === 'cube') return cubeMesh(radius);
  if (kind === 'slab') return slabMesh(radius);
  if (kind === 'octa') return octaMesh(radius);
  return icosaMesh(radius);
}

function uniqueEdges(faces: Face[]): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo},${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out;
}

export function buildShellGeom(
  kind: IceDef['shell'],
  radius: number,
  color: Beam,
  intensity: number,
): IceShellGeom {
  const { verts, faces } = shellMesh(kind, radius);
  const tris: number[] = [];
  const uvs: number[] = [];
  const faceId: number[] = [];
  const normals: number[] = [];
  const faceInfo: IceFaceInfo[] = [];

  for (let fi = 0; fi < faces.length; fi++) {
    const idx = faces[fi]!;
    const pts = idx.map((i) => verts[i]!);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const inv = 1 / pts.length;
    cx *= inv;
    cy *= inv;
    cz *= inv;
    const a = pts[0]!;
    const b = pts[1]!;
    const c = pts[pts.length - 1]!;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    const normal = vec3(nx, ny, nz);
    const { tangent, bitangent } = orthonormal(normal);
    let size = 0;
    for (const p of pts) size += Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
    size /= pts.length;
    faceInfo.push({ center: vec3(cx, cy, cz), normal, tangent, bitangent, size });

    const fan = (i0: number, i1: number, i2: number, u0: Vert, u1: Vert, u2: Vert): void => {
      const push = (p: Vert, u: Vert): void => {
        tris.push(p[0], p[1], p[2]);
        uvs.push(u[0], u[1]);
        faceId.push(fi);
        normals.push(nx, ny, nz);
      };
      push(pts[i0]!, u0);
      push(pts[i1]!, u1);
      push(pts[i2]!, u2);
    };
    if (pts.length === 3) {
      fan(0, 1, 2, [0, 0, 0], [1, 0, 0], [0.5, 1, 0]);
    } else {
      fan(0, 1, 2, [0, 0, 0], [1, 0, 0], [1, 1, 0]);
      fan(0, 2, 3, [0, 0, 0], [1, 1, 0], [0, 1, 0]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('aUv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('aFace', new BufferAttribute(new Float32Array(faceId), 1));

  const edges = uniqueEdges(faces);
  const lines = createLineSet(edges.length, { width: true, flags: true });
  for (let i = 0; i < edges.length; i++) {
    const [ia, ib] = edges[i]!;
    const pa = verts[ia]!;
    const pb = verts[ib]!;
    const p = i * 6;
    lines.positions[p] = pa[0];
    lines.positions[p + 1] = pa[1];
    lines.positions[p + 2] = pa[2];
    lines.positions[p + 3] = pb[0];
    lines.positions[p + 4] = pb[1];
    lines.positions[p + 5] = pb[2];
    lines.color[i] = color;
    lines.intensity[i] = intensity;
    lines.width![i] = DEFAULT_BEAM_WIDTH;
    lines.flags![i] = BeamFlag.DWELL;
  }

  return { geometry, lines, faces: faceInfo };
}

export function nestedRadii(outer: number, shells: number): number[] {
  const n = Math.max(1, shells);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : 1 - i / (n + 0.35);
    out.push(outer * Math.max(0.32, t));
  }
  return out;
}

export function lookFor(def: IceDef) {
  return classLook(def.class);
}

export function createFacetMesh(geom: IceShellGeom, facet: IceFacetMaterial): Mesh {
  const mesh = new Mesh(geom.geometry, facet.material);
  mesh.frustumCulled = false;
  mesh.name = 'iceFacet';
  mesh.onBeforeRender = facet.material.userData.syncFrame as Mesh['onBeforeRender'];
  return mesh;
}
