/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  ShaderMaterial,
  type Matrix4,
} from 'three';
import type { Palette } from '../palette';
import { Beam, DEFAULT_BEAM_INTENSITY } from '../lines/BeamBatch';
import { ASCII_END, ASCII_START } from './HersheyText';
import vfdVert from './vfd.vert';
import vfdFrag from './vfd.frag';

/** Unlit-segment brightness (plan M3.1 AC). */
export const VFD_GHOST = 0.06;
export const VFD_ASPECT = 0.58;
export const VFD_ADVANCE = 0.86;

export type VfdMode = 7 | 14;
export type VfdAlign = 'left' | 'center' | 'right';

const BIT = {
  A: 1 << 0,
  B: 1 << 1,
  C: 1 << 2,
  D: 1 << 3,
  E: 1 << 4,
  F: 1 << 5,
  G: 1 << 6,
  g: 1 << 7,
  H: 1 << 8,
  I: 1 << 9,
  J: 1 << 10,
  K: 1 << 11,
  L: 1 << 12,
  M: 1 << 13,
  DP: 1 << 14,
  COL: 1 << 15,
} as const;

/** Printable ASCII 32–126; lowercase already folded to upper. */
const MASK14 = /* @__PURE__ */ Uint16Array.from([
  0, 20992, 34, 13248, 4845, 3108, 2285, 512, 57, 15, 11712, 4800, 16384, 192, 16384, 3072, 3135,
  1030, 219, 143, 230, 237, 253, 7, 255, 239, 49152, 49152, 9216, 200, 2304, 20675, 191, 247, 4751,
  57, 4623, 121, 113, 189, 246, 4617, 30, 9328, 56, 1334, 8502, 63, 243, 8255, 8435, 237, 4609, 62,
  3120, 10294, 11520, 5376, 3081, 57, 8448, 15, 1280, 8, 32, 247, 4751, 57, 4623, 121, 113, 189,
  246, 4617, 30, 9328, 56, 1334, 8502, 63, 243, 8255, 8435, 237, 4609, 62, 3120, 10294, 11520, 5376,
  3081, 121, 4608, 143, 192,
]);

const MASK7 = /* @__PURE__ */ Uint16Array.from([
  0, 20992, 34, 13248, 4845, 3108, 2285, 512, 57, 15, 11712, 4800, 16384, 64, 16384, 3072, 63, 6,
  91, 79, 102, 109, 125, 7, 127, 111, 49152, 49152, 9216, 200, 2304, 20675, 191, 119, 124, 57, 94,
  121, 113, 61, 118, 6, 30, 9328, 56, 1334, 55, 63, 115, 8255, 8435, 109, 4609, 62, 3120, 10294,
  11520, 5376, 3081, 57, 8448, 15, 1280, 8, 32, 119, 124, 57, 94, 121, 113, 61, 118, 6, 30, 9328,
  56, 1334, 55, 63, 115, 8255, 8435, 109, 4609, 62, 3120, 10294, 11520, 5376, 3081, 121, 4608, 143,
  192,
]);

export function vfdMask(ch: string, mode: VfdMode = 14): number {
  const i = (ch.charCodeAt(0) || 0) - ASCII_START;
  if (i < 0 || i > ASCII_END - ASCII_START) return 0;
  return (mode === 7 ? MASK7 : MASK14)[i]!;
}

export function vfdWidth(text: string, size: number): number {
  return text.length * size * VFD_ADVANCE;
}

export interface VfdTextOpts {
  color?: Beam;
  intensity?: number;
  size?: number;
  align?: VfdAlign;
  mode?: VfdMode;
  ghost?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

export interface VfdText {
  readonly capacity: number;
  readonly object: Mesh;
  readonly material: ShaderMaterial;
  readonly count: number;
  ghost: boolean;
  transform: Matrix4;
  visible: boolean;
  setText(text: string, opts?: VfdTextOpts): void;
  dispose(): void;
}

export interface CreateVfdTextOptions {
  capacity?: number;
  ghost?: boolean;
  size?: number;
}

export function createVfdText(palette: Palette, opts: CreateVfdTextOptions = {}): VfdText {
  const capacity = Math.max(1, opts.capacity ?? 128);
  const defaultSize = opts.size ?? 1;
  let ghostOn = opts.ghost ?? true;

  const geo = new InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
  );
  geo.setIndex([0, 1, 2, 1, 3, 2]);

  const aOrigin = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aSize = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const aData = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  aOrigin.setUsage(DynamicDrawUsage);
  aSize.setUsage(DynamicDrawUsage);
  aData.setUsage(DynamicDrawUsage);
  geo.setAttribute('aOrigin', aOrigin);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aData', aData);
  geo.instanceCount = 0;

  const material = new ShaderMaterial({
    name: 'vfdText',
    glslVersion: GLSL3,
    vertexShader: vfdVert,
    fragmentShader: vfdFrag,
    uniforms: {
      uPalette: palette.uniform,
      uGhost: { value: VFD_GHOST },
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

  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.name = 'VfdText';
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const far = 'far' in camera ? (camera.far as number) : 1000;
    material.uniforms.logDepthBufFC!.value = 2 / (Math.log(far + 1) / Math.LN2);
  };

  const originArr = aOrigin.array as Float32Array;
  const sizeArr = aSize.array as Float32Array;
  const dataArr = aData.array as Float32Array;
  let count = 0;

  const batch: VfdText = {
    capacity,
    object: mesh,
    material,
    transform: mesh.matrix,
    get visible() {
      return mesh.visible;
    },
    set visible(v) {
      mesh.visible = v;
    },
    get count() {
      return count;
    },
    get ghost() {
      return ghostOn;
    },
    set ghost(v) {
      ghostOn = v;
    },
    setText(text, layout = {}) {
      const size = layout.size ?? defaultSize;
      const w = size * VFD_ASPECT;
      const adv = size * VFD_ADVANCE;
      const color = layout.color ?? Beam.AMBER;
      const intensity = layout.intensity ?? DEFAULT_BEAM_INTENSITY;
      const mode = layout.mode ?? 14;
      const ghost = layout.ghost ?? ghostOn;
      const lines = text.split('\n');
      let longest = 0;
      for (const line of lines) longest = Math.max(longest, line.length);
      let x0 = layout.x ?? 0;
      if (layout.align === 'center') x0 -= (longest * adv) / 2;
      else if (layout.align === 'right') x0 -= longest * adv;
      const y0 = layout.y ?? 0;
      const z0 = layout.z ?? 0;
      const flags = (ghost ? 1 : 0) + (mode === 7 ? 2 : 0);
      let n = 0;
      for (let row = 0; row < lines.length; row++) {
        const line = lines[row]!;
        for (let col = 0; col < line.length; col++) {
          if (n >= capacity) break;
          const i3 = n * 3;
          const i2 = n * 2;
          const i4 = n * 4;
          originArr[i3] = x0 + col * adv;
          originArr[i3 + 1] = y0 - row * size * 1.15;
          originArr[i3 + 2] = z0;
          sizeArr[i2] = w;
          sizeArr[i2 + 1] = size;
          dataArr[i4] = color;
          dataArr[i4 + 1] = intensity;
          dataArr[i4 + 2] = vfdMask(line[col]!, mode);
          dataArr[i4 + 3] = flags;
          n++;
        }
      }
      count = n;
      aOrigin.addUpdateRange(0, n * 3);
      aSize.addUpdateRange(0, n * 2);
      aData.addUpdateRange(0, n * 4);
      aOrigin.needsUpdate = true;
      aSize.needsUpdate = true;
      aData.needsUpdate = true;
      geo.instanceCount = n;
      mesh.visible = n > 0;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
  return batch;
}

export { ASCII_END, ASCII_START, BIT as VfdBit };
