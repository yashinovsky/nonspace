/// <reference types="vite-plugin-glsl/ext" />
import { GLSL3, Mesh, PlaneGeometry, ShaderMaterial, type Object3D, type Texture } from 'three';
import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch, type BeamBatchGpu } from '../render/lines/BeamBatch';
import { createBitmapText, createPx437Texture, PX437_ATLAS } from '../render/text/BitmapText';

const PIP_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PIP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tFeed;
uniform float uPain;
uniform float uLink;
uniform float uTime;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = vec3(0.03, 0.045, 0.04);
  if (uLink > 0.5) {
    c = texture(tFeed, vUv).rgb;
  }
  float scan = 0.78 + 0.22 * step(0.5, fract(vUv.y * 48.0));
  c *= scan;
  float pulse = 0.55 + 0.45 * sin(uTime * 12.566);
  float red = clamp(uPain, 0.0, 1.0) * 0.42 * pulse;
  c = mix(c, vec3(c.r * 1.15, c.g * 0.28, c.b * 0.22), red);
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  c *= smoothstep(0.0, 0.05, edge);
  fragColor = vec4(c, 1.0);
}
`;

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

export interface Pip {
  readonly objects: readonly Object3D[];
  link: boolean;
  pain: number;
  layout(x: number, y: number, w: number, h: number, z: number): void;
  setFeed(texture: Texture | null): void;
  update(time: number): void;
  dispose(): void;
}

/**
 * Molly's live raster thumbnail. Frame is vector chrome; the feed is a small
 * CRT quad. Pain spikes tint it red (low-contrast, 2 Hz). M4 does not own this.
 */
export function createPip(palette: Palette, opts: { z?: number; feed?: Texture | null } = {}): Pip {
  const z0 = opts.z ?? -1;
  const geo = new PlaneGeometry(1, 1);
  const material = new ShaderMaterial({
    name: 'hudPip',
    glslVersion: GLSL3,
    vertexShader: PIP_VERT,
    fragmentShader: PIP_FRAG,
    uniforms: {
      tFeed: { value: opts.feed ?? null },
      uPain: { value: 0 },
      uLink: { value: 0 },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    transparent: false,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.name = 'HudPipFeed';

  const frame = createBeamBatch(palette, {
    capacity: 8,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.55, dwell: 0.3 },
  });
  frame.object.name = 'HudPipFrame';
  frame.material.depthTest = false;

  const atlas = createPx437Texture();
  const caption = createBitmapText(palette, atlas, PX437_ATLAS, { capacity: 12, cellSize: 8 });
  caption.material.depthTest = false;
  caption.object.name = 'HudPipCaption';

  let x = 0;
  let y = 0;
  let w = 120;
  let h = 90;
  let z = z0;
  let link = false;
  let pain = 0;

  const push = (
    batch: BeamBatchGpu,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: Beam,
    i: number,
  ): void => {
    _a.x = x0;
    _a.y = y0;
    _a.z = z;
    _b.x = x1;
    _b.y = y1;
    _b.z = z;
    batch.push(_a, _b, c, i, 1.4, BeamFlag.NO_FOG);
  };

  const placeMesh = (): void => {
    mesh.position.set(x + w * 0.5, y + h * 0.5, z + 0.02);
    mesh.scale.set(w, h, 1);
  };

  return {
    objects: [mesh, frame.object, caption.object],
    get link() {
      return link;
    },
    set link(v) {
      link = v;
    },
    get pain() {
      return pain;
    },
    set pain(v) {
      pain = Math.min(1, Math.max(0, v));
    },
    layout(nx, ny, nw, nh, nz) {
      x = nx;
      y = ny;
      w = nw;
      h = nh;
      z = nz;
      placeMesh();
    },
    setFeed(texture) {
      material.uniforms.tFeed!.value = texture;
    },
    update(time) {
      material.uniforms.uPain!.value = pain;
      material.uniforms.uLink!.value = link ? 1 : 0;
      material.uniforms.uTime!.value = time;
      placeMesh();
      frame.beginDynamic();
      push(frame, x, y, x + w, y, Beam.GRID, 0.9);
      push(frame, x + w, y, x + w, y + h, Beam.GRID, 0.9);
      push(frame, x + w, y + h, x, y + h, Beam.GRID, 0.9);
      push(frame, x, y + h, x, y, Beam.GRID, 0.9);
      frame.endDynamic();
      const cell = Math.max(7, Math.round(h * 0.09));
      caption.setText(link ? 'MOLLY' : 'NO LINK', {
        x: x + 4,
        y: y + 4,
        z: z + 0.04,
        cellSize: cell,
        color: link ? Beam.AMBER : Beam.GRID,
        intensity: link ? 1.1 : 0.7,
      });
    },
    dispose() {
      geo.dispose();
      material.dispose();
      frame.dispose();
      caption.dispose();
      atlas.dispose();
    },
  };
}
