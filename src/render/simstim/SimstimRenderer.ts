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
import { buildSimstimScene } from '../../content/simstim/senseNetScene';
import type { SimstimTimeline } from '../../content/simstim/types';
import type { PainOverlay } from '../../simstim/Pain';
import type { FigureSample, TimelineSample } from '../../simstim/MollyTimeline';
import type { Renderer } from '../Renderer';
import { createSimstimKit, type ZoneStats, emptyZoneStats } from './kit';
import { hexToRgb01, SIMSTIM_PALETTE_HEX } from './palette';
import flatDitherBody from './flatDither.frag';

const LIGHT = new Vector3(0.35, 0.82, 0.45).normalize();

const VERT = /* glsl */ `varying vec3 vWorldPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorldPos=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;
#include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `varying vec3 vWorldPos;
uniform vec3 uAlbedo;uniform vec3 uLightDir;uniform float uAmbient;uniform float uDither;uniform vec3 uPalette[16];
#include <common>
#include <logdepthbuf_pars_fragment>
${flatDitherBody}
void main(){
#include <logdepthbuf_fragment>
vec3 n=normalize(cross(dFdx(vWorldPos),dFdy(vWorldPos)));if(!gl_FrontFacing)n=-n;
float ndl=max(0.0,dot(n,uLightDir));
vec3 lit=uAlbedo*(uAmbient+(1.0-uAmbient)*ndl);
gl_FragColor=vec4(ditherQuantize(lit,gl_FragCoord.xy,uDither,uPalette),1.0);
}`;

const VIGNETTE_VERT = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const VIGNETTE_FRAG = /* glsl */ `varying vec2 vUv;uniform float uPain;uniform float uSilver;uniform float uBright;
void main(){vec2 p=vUv*2.0-1.0;float vig=smoothstep(0.45,1.2,length(p));
vec3 col=mix(vec3(0.62,0.68,0.74),vec3(0.72,0.04,0.05),clamp(uPain*1.2,0.0,1.0));
gl_FragColor=vec4(col*uBright,vig*uSilver*0.55+uPain*vig*0.75);}`;

export interface SimstimRenderer {
  load(def: SimstimTimeline): void;
  apply(sample: TimelineSample, overlay: PainOverlay, meatTime: number): void;
  dispose(): void;
  readonly stats: ZoneStats;
}

const PALETTE_VEC = SIMSTIM_PALETTE_HEX.map((h) => new Vector3(...hexToRgb01(h)));

function createFlatDitherMaterial(hex: number, ambient = 0.72): ShaderMaterial {
  const c = new Color(hex);
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAlbedo: { value: new Vector3(c.r, c.g, c.b) },
      uLightDir: { value: LIGHT },
      uAmbient: { value: ambient },
      uDither: { value: 0.07 },
      uPalette: { value: PALETTE_VEC },
    },
    toneMapped: false,
    side: DoubleSide,
  });
}

export function createSimstimRenderer(renderer: Renderer): SimstimRenderer {
  const scene = renderer.scenes.simstim;
  const camera = renderer.cameras.simstim;
  const root = new Group();
  scene.add(root);

  const figures = new Map<string, Object3D>();
  const mats: ShaderMaterial[] = [];
  const boxGeom = new BoxGeometry(1, 1, 1);
  const planeGeom = new PlaneGeometry(1, 1);
  const geoms = [boxGeom, planeGeom];
  const alarms: Mesh[] = [];
  let stats: ZoneStats = emptyZoneStats();

  const clock = makeChipClock();
  clock.mesh.position.set(-0.32, -0.2, -0.5);

  const vigMat = new ShaderMaterial({
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
  const api: SimstimRenderer = {
    get stats() {
      return stats;
    },
    load(def) {
      clearGroup(root);
      figures.clear();
      alarms.length = 0;
      const kit = createSimstimKit({
        root,
        figures,
        boxGeom,
        planeGeom,
        material(hex, ambient) {
          const m = createFlatDitherMaterial(hex, ambient);
          mats.push(m);
          return m;
        },
      });
      buildSimstimScene(def.scene, kit);
      for (const a of kit.alarms) alarms.push(a);
      stats = { ...kit.stats };
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
      pulseAlarms(alarms, sample, meatTime);
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
      alarms.length = 0;
    },
  };

  return api;
}

function pulseAlarms(alarms: Mesh[], sample: TimelineSample, meatTime: number): void {
  if (alarms.length === 0) return;
  let panic = false;
  for (const fig of sample.figures) {
    if (fig.pose === 'run') {
      panic = true;
      break;
    }
  }
  const on = !panic || Math.sin(meatTime * Math.PI * 2 * 1.5) > 0;
  for (const a of alarms) a.visible = on;
}

function poseCamera(camera: PerspectiveCamera, sample: TimelineSample, look: Vector3): void {
  camera.position.set(sample.camera.pos.x, sample.camera.pos.y, sample.camera.pos.z);
  look.set(sample.camera.look.x, sample.camera.look.y, sample.camera.look.z);
  camera.lookAt(look);
}

function poseFigure(obj: Object3D | undefined, fig: FigureSample): void {
  if (!obj) return;
  obj.visible = fig.pose !== 'hidden';
  obj.position.set(fig.pos.x, fig.pos.y, fig.pos.z);
  obj.rotation.y = fig.yaw;
  obj.rotation.x = fig.pose === 'wait' ? 0.08 : fig.pose === 'run' ? 0.18 : 0;
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
  return g;
}

function makeChipClock(): { mesh: Mesh; ctx: CanvasRenderingContext2D; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ctx');
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

function drawChipClock(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#ff2820';
  ctx.font = 'bold 36px ui-monospace,monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 6, ctx.canvas.height / 2);
}

function clearGroup(root: Group): void {
  while (root.children.length > 0) root.remove(root.children[0]!);
}
