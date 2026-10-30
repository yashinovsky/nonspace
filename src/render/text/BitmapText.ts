/// <reference types="vite-plugin-glsl/ext" />
import {
  AddEquation,
  CustomBlending,
  DataTexture,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  OneFactor,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  type Matrix4,
  type Texture,
} from 'three';
import type { Palette } from '../palette';
import { Beam, DEFAULT_BEAM_INTENSITY } from '../lines/BeamBatch';
import bitmapVert from './bitmapText.vert';
import bitmapFrag from './bitmapText.frag';
import { ASCII_END, ASCII_START } from './HersheyText';

export interface Px437Atlas {
  name: string;
  cell: number;
  cols: number;
  rows: number;
  first: number;
  count: number;
  image: string;
  ascii?: readonly number[];
}

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export type BitmapAlign = 'left' | 'center' | 'right';

export interface BitmapTextOpts {
  color?: Beam;
  intensity?: number;
  /** World size of one 8px cell. */
  cellSize?: number;
  align?: BitmapAlign;
  x?: number;
  y?: number;
  z?: number;
  /** Extra cells of tracking. */
  tracking?: number;
}

export interface BitmapText {
  readonly capacity: number;
  readonly object: Mesh;
  readonly material: ShaderMaterial;
  readonly atlas: Px437Atlas;
  readonly count: number;
  transform: Matrix4;
  visible: boolean;
  setText(text: string, opts?: BitmapTextOpts): void;
  dispose(): void;
}

export const PX437_ATLAS: Px437Atlas = {
  name: 'Px437 IBM CGA',
  cell: 8,
  cols: 16,
  rows: 6,
  first: ASCII_START,
  count: ASCII_END - ASCII_START + 1,
  image: 'rom',
  ascii: [ASCII_START, ASCII_END],
};

/** IBM 8×8 ROM bytes for ASCII 32–126, base64. */
const PX437_ROM =
  'AAAAAAAAAAAYPDwYGAAYADY2AAAAAAAANjZ/Nn82NgAMPgMeMB8MAABjMxgMZmMAHDYcbjszbgAGBgMAAAAAABgMBgYGDBgABgwYGBgMBgAAZjz/PGYAAAAMDD8MDAAAAAAAAAAMDAYAAAA/AAAAAAAAAAAADAwAYDAYDAYDAQA+Y3N7b2c+AAwODAwMDD8AHjMwHAYzPwAeMzAcMDMeADg8NjN/MHgAPwMfMDAzHgAcBgMfMzMeAD8zMBgMDAwAHjMzHjMzHgAeMzM+MBgOAAAMDAAADAwAAAwMAAAMDAYYDAYDBgwYAAAAPwAAPwAABgwYMBgMBgAeMzAYDAAMAD5je3t7Ax4ADB4zMz8zMwA/ZmY+ZmY/ADxmAwMDZjwAHzZmZmY2HwB/RhYeFkZ/AH9GFh4WBg8APGYDA3NmfAAzMzM/MzMzAB4MDAwMDB4AeDAwMDMzHgBnZjYeNmZnAA8GBgZGZn8AY3d/f2tjYwBjZ297c2NjABw2Y2NjNhwAP2ZmPgYGDwAeMzMzOx44AD9mZj42ZmcAHjMHDjgzHgA/LQwMDAweADMzMzMzMz8AMzMzMzMeDABjY2Nrf3djAGNjNhwcNmMAMzMzHgwMHgB/YzEYTGZ/AB4GBgYGBh4AAwYMGDBgQAAeGBgYGBgeAAgcNmMAAAAAAAAAAAAAAP8MDBgAAAAAAAAAHjA+M24ABwYGPmZmOwAAAB4zAzMeADgwMD4zM24AAAAeMz8DHgAcNgYPBgYPAAAAbjMzPjAfBwY2bmZmZwAMAA4MDAweADAAMDAwMzMeBwZmNh42ZwAODAwMDAweAAAAM39/a2MAAAAfMzMzMwAAAB4zMzMeAAAAO2ZmPgYPAABuMzM+MHgAADtuZgYPAAAAPgMeMB8ACAw+DAwsGAAAADMzMzNuAAAAMzMzHgwAAABja39/NgAAAGM2HDZjAAAAMzMzPjAfAAA/GQwmPwA4DAwHDAw4ABgYGAAYGBgABwwMOAwMBwBuOwAAAAAAAA==';

export function parsePx437Atlas(json: Px437Atlas): Px437Atlas {
  if (!(json.cell > 0) || !(json.cols > 0) || !(json.rows > 0)) {
    throw new Error('invalid Px437 atlas JSON');
  }
  return json;
}

/** Nearest 128×64 RGBA atlas from the IBM 8×8 ROM (no PNG fetch). */
export function createPx437Texture(): DataTexture {
  const cell = PX437_ATLAS.cell;
  const cols = PX437_ATLAS.cols;
  const rows = PX437_ATLAS.rows;
  const width = cols * cell;
  const height = rows * cell;
  const rom = Uint8Array.from(atob(PX437_ROM), (c) => c.charCodeAt(0));
  const data = new Uint8Array(width * height * 4);
  for (let code = 0; code < PX437_ATLAS.count; code++) {
    const col = code % cols;
    const row = (code / cols) | 0;
    for (let y = 0; y < cell; y++) {
      const bits = rom[code * cell + y] ?? 0;
      for (let x = 0; x < cell; x++) {
        if (((bits >> (7 - x)) & 1) === 0) continue;
        const i = ((row * cell + y) * width + (col * cell + x)) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  prepareAtlasTexture(texture);
  return texture;
}

export async function loadPx437Atlas(url: string): Promise<Px437Atlas> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Px437 atlas ${url}: HTTP ${res.status}`);
  return parsePx437Atlas((await res.json()) as Px437Atlas);
}

/** UVs for a glyph. `flipY` matches Three's default Texture.flipY. */
export function uvForChar(atlas: Px437Atlas, code: number, flipY = true, out: UvRect): UvRect {
  const first = atlas.first;
  const i = Math.min(atlas.count - 1, Math.max(0, code - first));
  const col = i % atlas.cols;
  const row = (i / atlas.cols) | 0;
  const du = 1 / atlas.cols;
  const dv = 1 / atlas.rows;
  const padU = 0.5 / (atlas.cols * atlas.cell);
  const padV = 0.5 / (atlas.rows * atlas.cell);
  const u0 = col * du + padU;
  const u1 = (col + 1) * du - padU;
  const vTop = row * dv + padV;
  const vBot = (row + 1) * dv - padV;
  if (flipY) {
    out.u0 = u0;
    out.v0 = 1 - vBot;
    out.u1 = u1;
    out.v1 = 1 - vTop;
  } else {
    out.u0 = u0;
    out.v0 = vBot;
    out.u1 = u1;
    out.v1 = vTop;
  }
  return out;
}

export function measureBitmap(
  text: string,
  cellSize: number,
  tracking = 0,
): { width: number; height: number } {
  return { width: text.length * cellSize * (1 + tracking), height: cellSize };
}

function prepareAtlasTexture(texture: Texture): Texture {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

export interface CreateBitmapTextOptions {
  capacity?: number;
  cellSize?: number;
}

export function createBitmapText(
  palette: Palette,
  texture: Texture,
  atlas: Px437Atlas,
  opts: CreateBitmapTextOptions = {},
): BitmapText {
  const capacity = Math.max(1, opts.capacity ?? 256);
  const defaultCell = opts.cellSize ?? 1;
  prepareAtlasTexture(texture);

  const geo = new InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
  );
  geo.setIndex([0, 1, 2, 1, 3, 2]);

  const aOrigin = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aSize = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const aUvRect = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const aData = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  aOrigin.setUsage(DynamicDrawUsage);
  aSize.setUsage(DynamicDrawUsage);
  aUvRect.setUsage(DynamicDrawUsage);
  aData.setUsage(DynamicDrawUsage);
  geo.setAttribute('aOrigin', aOrigin);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aUvRect', aUvRect);
  geo.setAttribute('aData', aData);
  geo.instanceCount = 0;

  const material = new ShaderMaterial({
    name: 'bitmapText',
    glslVersion: GLSL3,
    vertexShader: bitmapVert,
    fragmentShader: bitmapFrag,
    uniforms: {
      uPalette: palette.uniform,
      tAtlas: { value: texture },
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
  mesh.name = 'BitmapText';
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const far = 'far' in camera ? (camera.far as number) : 1000;
    material.uniforms.logDepthBufFC!.value = 2 / (Math.log(far + 1) / Math.LN2);
  };

  const originArr = aOrigin.array as Float32Array;
  const sizeArr = aSize.array as Float32Array;
  const uvArr = aUvRect.array as Float32Array;
  const dataArr = aData.array as Float32Array;
  const uv: UvRect = { u0: 0, v0: 0, u1: 0, v1: 0 };
  let count = 0;

  const batch: BitmapText = {
    capacity,
    object: mesh,
    material,
    atlas,
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
    setText(text, layout = {}) {
      const cell = layout.cellSize ?? defaultCell;
      const tracking = layout.tracking ?? 0;
      const adv = cell * (1 + tracking);
      const color = layout.color ?? Beam.GRID;
      const intensity = layout.intensity ?? DEFAULT_BEAM_INTENSITY;
      const lines = text.split('\n');
      let longest = 0;
      for (const line of lines) longest = Math.max(longest, line.length);
      let x0 = layout.x ?? 0;
      if (layout.align === 'center') x0 -= (longest * adv) / 2;
      else if (layout.align === 'right') x0 -= longest * adv;
      const y0 = layout.y ?? 0;
      const z0 = layout.z ?? 0;
      let n = 0;
      for (let row = 0; row < lines.length; row++) {
        const line = lines[row]!;
        for (let col = 0; col < line.length; col++) {
          if (n >= capacity) break;
          uvForChar(atlas, line.charCodeAt(col), true, uv);
          const i3 = n * 3;
          const i2 = n * 2;
          const i4 = n * 4;
          originArr[i3] = x0 + col * adv;
          originArr[i3 + 1] = y0 - row * cell;
          originArr[i3 + 2] = z0;
          sizeArr[i2] = cell;
          sizeArr[i2 + 1] = cell;
          uvArr[i4] = uv.u0;
          uvArr[i4 + 1] = uv.v0;
          uvArr[i4 + 2] = uv.u1;
          uvArr[i4 + 3] = uv.v1;
          dataArr[i4] = color;
          dataArr[i4 + 1] = intensity;
          dataArr[i4 + 2] = 0;
          dataArr[i4 + 3] = 0;
          n++;
        }
      }
      count = n;
      aOrigin.addUpdateRange(0, n * 3);
      aSize.addUpdateRange(0, n * 2);
      aUvRect.addUpdateRange(0, n * 4);
      aData.addUpdateRange(0, n * 4);
      aOrigin.needsUpdate = true;
      aSize.needsUpdate = true;
      aUvRect.needsUpdate = true;
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

export { ASCII_END, ASCII_START };
