/// <reference types="vite-plugin-glsl/ext" />
import {
  GLSL3,
  Mesh,
  NoBlending,
  OctahedronGeometry,
  ShaderMaterial,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { BeamFlag, createLineSet, type LineSet } from '../lines/BeamBatch';
import blackIceFrag from './blackIce.frag';
import blackIceVert from './blackIce.vert';

function logDepthFC(far: number): number {
  return 2 / (Math.log(far + 1) / Math.LN2);
}

/**
 * Coverage material for `scenes.blackIce` → `blackIceMask` (R8).
 * Fragments write 1 so the composite can subtract HDR+bloom.
 */
export function createBlackIceMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    name: 'blackIce',
    glslVersion: GLSL3,
    vertexShader: blackIceVert,
    fragmentShader: blackIceFrag,
    uniforms: {
      logDepthBufFC: { value: logDepthFC(60_000) },
      uCoverage: { value: 1 },
    },
    depthTest: true,
    depthWrite: true,
    transparent: false,
    toneMapped: false,
    fog: false,
    blending: NoBlending,
  });

  const sync = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
    const persp = camera as PerspectiveCamera;
    material.uniforms.logDepthBufFC!.value = logDepthFC(persp.far ?? 60_000);
  };
  material.userData.syncFrame = sync;
  return material;
}

export interface BlackIceSolid {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  dispose(): void;
}

/** Faceted shard. Put `mesh` on `renderer.scenes.blackIce`. */
export function createBlackIceSolid(radius = 1): BlackIceSolid {
  const material = createBlackIceMaterial();
  const geometry = new OctahedronGeometry(radius, 0);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'blackIceSolid';
  mesh.frustumCulled = false;
  mesh.onBeforeRender = material.userData.syncFrame as Mesh['onBeforeRender'];
  return {
    mesh,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** 12 edges of a unit octahedron, for the UV crawl batch. */
export function octahedronLineSet(intensity = 0.85, width = 1.35): LineSet {
  const verts: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const edges: ReadonlyArray<readonly [number, number]> = [
    [2, 0],
    [2, 1],
    [2, 4],
    [2, 5],
    [3, 0],
    [3, 1],
    [3, 4],
    [3, 5],
    [0, 4],
    [4, 1],
    [1, 5],
    [5, 0],
  ];
  const set = createLineSet(edges.length, { width: true, flags: true });
  for (let i = 0; i < edges.length; i++) {
    const [ia, ib] = edges[i]!;
    const a = verts[ia]!;
    const b = verts[ib]!;
    const p = i * 6;
    set.positions[p] = a[0];
    set.positions[p + 1] = a[1];
    set.positions[p + 2] = a[2];
    set.positions[p + 3] = b[0];
    set.positions[p + 4] = b[1];
    set.positions[p + 5] = b[2];
    set.color[i] = 0;
    set.intensity[i] = intensity;
    set.width![i] = width;
    set.flags![i] = BeamFlag.NO_FOG;
  }
  return set;
}
