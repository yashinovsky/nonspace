import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { SimstimTimeline } from '../../content/simstim/types';
import { SEG7 } from '../../simstim/clock';
import type { PainOverlay } from '../../simstim/Pain';
import type { FigureSample, TimelineSample } from '../../simstim/MollyTimeline';
import type { Renderer } from '../Renderer';
import { hexToRgb01, SIMSTIM_PALETTE_HEX } from './palette';
import flatDitherBody from './flatDither.frag?raw';

const LIGHT = new Vector3(0.35, 0.82, 0.45).normalize();

const VERT = /* glsl */ `
varying vec3 vWorldPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec3 vWorldPos;
uniform vec3 uAlbedo;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uDither;
uniform vec3 uPalette[16];
#include <common>
#include <logdepthbuf_pars_fragment>
${flatDitherBody}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (!gl_FrontFacing) n = -n;
  float ndl = max(0.0, dot(n, uLightDir));
  vec3 lit = uAlbedo * (uAmbient + (1.0 - uAmbient) * ndl);
  vec3 col = ditherQuantize(lit, gl_FragCoord.xy, uDither, uPalette);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VIGNETTE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VIGNETTE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uPain;
uniform float uSilver;
uniform float uBright;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float vig = smoothstep(0.45, 1.2, r);
  vec3 silver = vec3(0.62, 0.68, 0.74);
  vec3 red = vec3(0.72, 0.04, 0.05);
  float a = vig * uSilver * 0.55 + uPain * vig * 0.75;
  vec3 col = mix(silver, red, clamp(uPain * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col * uBright, a);
}
`;

export interface SimstimRenderer {
  load(def: SimstimTimeline): void;
  apply(sample: TimelineSample, overlay: PainOverlay, meatTime: number): void;
  dispose(): void;
}

export function createFlatDitherMaterial(hex: number, ambient = 0.72): ShaderMaterial {
  const c = new Color(hex);
  return new ShaderMaterial({
    name: 'flatDither',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAlbedo: { value: new Vector3(c.r, c.g, c.b) },
      uLightDir: { value: LIGHT.clone() },
      uAmbient: { value: ambient },
      uDither: { value: 0.07 },
      uPalette: { value: SIMSTIM_PALETTE_HEX.map((hex) => new Vector3(...hexToRgb01(hex))) },
    },
    toneMapped: false,
    fog: false,
    side: DoubleSide,
  });
}

export function createSimstimRenderer(renderer: Renderer): SimstimRenderer {
  const scene = renderer.scenes.simstim;
  const camera = renderer.cameras.simstim;
  const root = new Group();
  root.name = 'simstim-root';
  scene.add(root);

  const figures = new Map<string, Object3D>();
  const mats: ShaderMaterial[] = [];
  const boxGeom = new BoxGeometry(1, 1, 1);
  const planeGeom = new PlaneGeometry(1, 1);
  const geoms = [boxGeom, planeGeom];

  const clock = makeChipClock();
  clock.mesh.position.set(-0.32, -0.2, -0.5);

  const vigMat = new ShaderMaterial({
    name: 'simstimVignette',
    vertexShader: VIGNETTE_VERT,
    fragmentShader: VIGNETTE_FRAG,
    uniforms: {
      uPain: { value: 0 },
      uSilver: { value: 0.7 },
      uBright: { value: 1.12 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const vig = new Mesh(new PlaneGeometry(1.6, 1.2), vigMat);
  vig.frustumCulled = false;
  vig.position.set(0, 0, -0.55);
  camera.add(vig);
  camera.add(clock.mesh);

  const hands = makeHands(boxGeom, mats);
  camera.add(hands);

  const lookTarget = new Vector3();
  let clockKey = '';
  let holdLeft = 0;
  let held: TimelineSample | null = null;

  const box = (
    hex: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    parent: Object3D = root,
  ): Mesh => {
    const mat = createFlatDitherMaterial(hex);
    mats.push(mat);
    const mesh = new Mesh(boxGeom, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  };

  const plane = (
    hex: number,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    rotX: number,
    rotY = 0,
    parent: Object3D = root,
  ): Mesh => {
    const mat = createFlatDitherMaterial(hex, 0.78);
    mats.push(mat);
    const mesh = new Mesh(planeGeom, mat);
    mesh.scale.set(w, h, 1);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.rotation.y = rotY;
    parent.add(mesh);
    return mesh;
  };

  const buildLobby = (): void => {
    plane(0x7a7680, 24, 16, 0, 0, -4, -Math.PI / 2);
    plane(0x4a4854, 24, 16, 0, 4.2, -4, Math.PI / 2);
    plane(0xa0b8c0, 24, 4.2, 0, 2.1, -12, 0);
    plane(0xa0b8c0, 16, 4.2, -12, 2.1, -4, 0, Math.PI / 2);
    plane(0xa0b8c0, 16, 4.2, 12, 2.1, -4, 0, -Math.PI / 2);
    box(0xb88858, 1.2, 1.4, 1.2, -3.4, 0.7, -5.5);
    box(0xe8b888, 0.8, 0.4, 1.6, 3.2, 0.2, -4.2);
    box(0x6e6a74, 0.3, 3.6, 0.3, -1.6, 1.8, -9.4);
    box(0x6e6a74, 0.3, 3.6, 0.3, 1.6, 1.8, -9.4);
    box(0x1c1a22, 2.2, 3.2, 0.12, 0, 1.6, -9.5);
    box(0xc03028, 0.35, 0.35, 0.12, 0.85, 2.2, -9.4);
    const mannequin = makeMannequin(boxGeom, mats);
    mannequin.position.set(2.1, 0, -6.2);
    mannequin.rotation.y = Math.PI;
    root.add(mannequin);
    figures.set('guard', mannequin);
  };

  const api: SimstimRenderer = {
    load(def) {
      clearGroup(root);
      figures.clear();
      buildLobby();
      void def;
    },
    apply(sample, overlay, meatTime) {
      if (overlay.frameHold > 0 && holdLeft > 0 && held) {
        holdLeft -= 1;
        poseCamera(camera, held, lookTarget);
        return;
      }
      holdLeft = overlay.frameHold;
      held = sample;
      poseCamera(camera, sample, lookTarget);
      for (const fig of sample.figures) poseFigure(figures.get(fig.id), fig);
      hands.rotation.z = Math.sin(sample.playbackTime * 3.2) * 0.04;
      vigMat.uniforms.uPain!.value = overlay.vignette;
      void meatTime;
      if (sample.clock !== clockKey) {
        clockKey = sample.clock;
        drawChipClock(clock.ctx, sample.clock);
        clock.tex.needsUpdate = true;
      }
    },
    dispose() {
      camera.remove(clock.mesh);
      camera.remove(vig);
      camera.remove(hands);
      clock.tex.dispose();
      (clock.mesh.material as MeshBasicMaterial).dispose();
      clock.mesh.geometry.dispose();
      vigMat.dispose();
      vig.geometry.dispose();
      clearGroup(root);
      scene.remove(root);
      for (const m of mats) m.dispose();
      for (const g of geoms) g.dispose();
      figures.clear();
    },
  };

  return api;
}

function poseCamera(camera: PerspectiveCamera, sample: TimelineSample, look: Vector3): void {
  camera.position.set(sample.camera.pos.x, sample.camera.pos.y, sample.camera.pos.z);
  look.set(sample.camera.look.x, sample.camera.look.y, sample.camera.look.z);
  camera.lookAt(look);
}

function poseFigure(obj: Object3D | undefined, fig: FigureSample): void {
  if (!obj) return;
  obj.position.set(fig.pos.x, fig.pos.y, fig.pos.z);
  obj.rotation.y = fig.yaw;
  obj.rotation.x = fig.pose === 'wait' ? 0.08 : 0;
}

function makeMannequin(geom: BoxGeometry, mats: ShaderMaterial[]): Group {
  const g = new Group();
  const part = (hex: number, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mat = createFlatDitherMaterial(hex);
    mats.push(mat);
    const mesh = new Mesh(geom, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  part(0xe8b888, 0.38, 0.42, 0.32, 0, 1.55, 0);
  part(0x5a7a8c, 0.55, 0.7, 0.28, 0, 1.05, 0);
  part(0x4a4854, 0.18, 0.55, 0.18, -0.22, 0.4, 0);
  part(0x4a4854, 0.18, 0.55, 0.18, 0.22, 0.4, 0);
  part(0x4a6a48, 0.16, 0.55, 0.16, -0.38, 1.05, 0);
  part(0x4a6a48, 0.16, 0.55, 0.16, 0.38, 1.05, 0);
  return g;
}

function makeHands(geom: BoxGeometry, mats: ShaderMaterial[]): Group {
  const g = new Group();
  const mat = createFlatDitherMaterial(0x1c1a22, 0.6);
  mats.push(mat);
  const l = new Mesh(geom, mat);
  l.scale.set(0.14, 0.08, 0.22);
  l.position.set(-0.28, -0.22, -0.48);
  l.rotation.set(0.4, 0.2, 0.15);
  const r = new Mesh(geom, mat);
  r.scale.set(0.14, 0.08, 0.22);
  r.position.set(0.3, -0.24, -0.5);
  r.rotation.set(0.35, -0.25, -0.1);
  g.add(l, r);
  g.position.set(0, 0, 0);
  return g;
}

function makeChipClock(): { mesh: Mesh; ctx: CanvasRenderingContext2D; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('chip clock canvas');
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  drawChipClock(ctx, '00:00:00');
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(0.55, 0.14), mat);
  mesh.frustumCulled = false;
  return { mesh, ctx, tex };
}

export function drawChipClock(ctx: CanvasRenderingContext2D, text: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const digitW = 22;
  const digitH = 36;
  const gap = 5;
  const colonW = 8;
  let x = 8;
  const y = (h - digitH) / 2;
  ctx.fillStyle = '#ff2820';
  for (const ch of text) {
    if (ch === ':') {
      ctx.fillRect(x + 3, y + 10, 3, 3);
      ctx.fillRect(x + 3, y + 22, 3, 3);
      x += colonW;
      continue;
    }
    const n = ch.charCodeAt(0) - 48;
    if (n >= 0 && n <= 9) drawDigit(ctx, x, y, digitW, digitH, SEG7[n]!);
    x += digitW + gap;
  }
}

function drawDigit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mask: number,
): void {
  const t = 4;
  const seg = (bit: number, rx: number, ry: number, rw: number, rh: number): void => {
    if (mask & bit) ctx.fillRect(x + rx, y + ry, rw, rh);
  };
  // a b c d e f g
  seg(1 << 0, t, 0, w - 2 * t, t);
  seg(1 << 1, w - t, t, t, h / 2 - t);
  seg(1 << 2, w - t, h / 2, t, h / 2 - t);
  seg(1 << 3, t, h - t, w - 2 * t, t);
  seg(1 << 4, 0, h / 2, t, h / 2 - t);
  seg(1 << 5, 0, t, t, h / 2 - t);
  seg(1 << 6, t, h / 2 - t / 2, w - 2 * t, t);
}

function clearGroup(root: Group): void {
  while (root.children.length > 0) root.remove(root.children[0]!);
}
