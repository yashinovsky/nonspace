import {
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import type { QualitySetting, SettingsStore } from '../core/settings';
import { createPalette, type Palette } from './palette';
import { createDynamicRes, type DynamicRes } from './dynamicRes';
import {
  createPostChain,
  createBlitter,
  type PostChain,
  type PostContext,
  type PostMode,
} from './post/PostChain';
import { createFullscreenMaterial } from './post/pass';
import { MAX_PIXEL_RATIO, resolveQuality, type GpuCaps, type QualityConfig } from './quality';
import {
  createColorTarget,
  createRenderTargets,
  probeHdr,
  readGpuRendererName,
  type RenderTargets,
} from './targets';

export interface RendererInfo {
  textures: number;
  geometries: number;
  programs: number;
  calls: number;
  width: number;
  height: number;
}

export interface Renderer {
  readonly three: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly targets: RenderTargets;
  readonly chain: PostChain;
  readonly palette: Palette;
  readonly dynamicRes: DynamicRes;
  readonly quality: QualityConfig;
  readonly caps: GpuCaps;
  readonly scenes: {
    matrix: Scene;
    blackIce: Scene;
    sky: Scene;
    hud: Scene;
    simstim: Scene;
  };
  readonly cameras: {
    matrix: PerspectiveCamera;
    hud: OrthographicCamera;
    simstim: PerspectiveCamera;
  };
  /** CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Internal RT size (after quality and dynres). */
  readonly internalWidth: number;
  readonly internalHeight: number;
  /** quality.baseScale * dynRes.scale. */
  readonly effectiveScale: number;
  postMode: PostMode;
  /**
   * Optional HDR scene drawer (M7.10 Beach). When set, replaces sky/matrix
   * draws so a fullscreen SDF pass can write `hdrScene` before the chain.
   */
  drawHdr: ((renderer: WebGLRenderer, target: WebGLRenderTarget) => void) | null;
  /** PIP thumbnail of the 320×240 simstim feed (live link, not flipped). */
  pipEnabled: boolean;
  exposure: number;
  /** Extra fullscreen shader iterations (debug / AC GPU load). 0 = off. */
  gpuLoad: number;
  setQuality(setting: QualitySetting): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  endFrame(dt: number, gpuMs: number | null): void;
  info(): RendererInfo;
  attachDebug(pane: DebugPaneLike): void;
  dispose(): void;
}

/** Structural Tweakpane folder API — avoids importing tweakpane into the game bundle. */
export interface DebugPaneLike {
  addFolder(opts: { title: string }): {
    addBinding(
      object: object,
      key: string,
      opts?: object,
    ): { on(event: 'change', cb: (ev: { value: unknown }) => void): unknown };
    addButton(opts: { title: string }): { on(event: 'click', cb: () => void): unknown };
  };
}

export interface RendererOptions {
  parent: HTMLElement;
  settings: SettingsStore;
  /** Session override (URL `?quality=` or tests). Does not persist. */
  qualityOverride?: QualitySetting;
}

const SIMSTIM_ASPECT = 320 / 240;

const PIP_FRAG = /* glsl */ `precision highp float;uniform sampler2D tInput;in vec2 vUv;out vec4 fragColor;
void main(){float scan=0.82+0.18*step(0.5,fract(vUv.y*48.0));vec3 c=texture(tInput,vUv).rgb*scan*1.05;
float edge=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));c*=smoothstep(0.0,0.045,edge);
c*=0.55+0.45*smoothstep(1.1,0.35,length(vUv*2.0-1.0));fragColor=vec4(c,1.0);}`;

const BURN_FRAG = /* glsl */ `precision highp float;uniform float uIters;in vec2 vUv;out vec4 fragColor;
void main(){vec2 uv=vUv;float a=0.0;int n=int(uIters);for(int i=0;i<256;i++){if(i>=n)break;
a+=fract(sin(dot(uv,vec2(12.9898,78.233))*float(i+1))*43758.5453);uv+=vec2(a*0.01);}
fragColor=vec4(a*1e-8,0.0,0.0,0.0);}`;

export function createRenderer(opts: RendererOptions): Renderer {
  const three = new WebGLRenderer({
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
  });
  three.setClearColor(0x000000, 1);
  three.autoClear = false;
  three.toneMapping = NoToneMapping;
  three.outputColorSpace = SRGBColorSpace;
  opts.parent.appendChild(three.domElement);

  const gl = three.getContext() as WebGL2RenderingContext;
  const caps: GpuCaps = {
    hdr: probeHdr(three),
    renderer: readGpuRendererName(gl),
  };

  let override: QualitySetting | undefined = opts.qualityOverride;
  const settingOf = (): QualitySetting => override ?? opts.settings.value.graphics.quality;
  let quality = resolveQuality(settingOf(), caps, {
    reduceMotion: opts.settings.value.reduceMotion,
  });

  const targets = createRenderTargets(1, 1, quality.hdr);
  const chain = createPostChain();
  const blitter = createBlitter();
  const palette = createPalette();
  const dynamicRes = createDynamicRes();
  dynamicRes.enabled = opts.settings.value.graphics.dynamicResolution;

  const scenes = {
    matrix: new Scene(),
    blackIce: new Scene(),
    sky: new Scene(),
    hud: new Scene(),
    simstim: new Scene(),
  };
  const cameras = {
    matrix: new PerspectiveCamera(75, 1, 0.5, 60_000),
    hud: new OrthographicCamera(0, 1, 1, 0, -1, 1),
    simstim: new PerspectiveCamera(60, SIMSTIM_ASPECT, 0.1, 100),
  };
  cameras.matrix.position.set(0, 0.55, 3.1);
  cameras.matrix.lookAt(0, 0, 0);

  const lastQuat = new Quaternion();
  const scratchQuat = new Quaternion();
  cameras.matrix.getWorldQuaternion(lastQuat);

  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let internalWidth = 1;
  let internalHeight = 1;
  let postMode: PostMode = 'matrix';
  let drawHdr: ((renderer: WebGLRenderer, target: WebGLRenderTarget) => void) | null = null;
  let pipEnabled = false;
  let exposure = 1;
  let gpuLoad = 0;
  let time = 0;

  const burnTarget = createColorTarget(64, 64, { hdr: false, depth: false });
  const burnMat = createFullscreenMaterial(BURN_FRAG, { uIters: { value: 0 } });
  const pipMat = createFullscreenMaterial(PIP_FRAG, { tInput: { value: null } });
  const drawingSize = new Vector2();

  const dummy: Texture = targets.hdrScene.texture;
  const ctx: PostContext = {
    renderer: three,
    targets,
    blit: (material, target) => blitter.blit(three, material, target),
    quality,
    scale: 1,
    dt: 0,
    time: 0,
    mode: 'matrix',
    angularVelocity: 0,
    reduceFlashing: opts.settings.value.reduceFlashing,
    reduceMotion: opts.settings.value.reduceMotion,
    hdr: dummy,
    combined: dummy,
    bloom: null,
    encoded: 'hdr',
    exposure: 1,
    vectorLoad: 0,
  };

  const debugState = {
    setting: settingOf() as string,
    tier: quality.tier,
    scale: 1,
    size: '1×1',
    hdr: quality.hdr ? '16F' : 'RGBA8',
    textures: 0,
    dyn: 1,
  };

  const applyQuality = (): void => {
    quality = resolveQuality(settingOf(), caps, {
      reduceMotion: opts.settings.value.reduceMotion,
    });
    ctx.quality = quality;
    ctx.reduceMotion = opts.settings.value.reduceMotion;
    ctx.reduceFlashing = opts.settings.value.reduceFlashing;
    dynamicRes.enabled = opts.settings.value.graphics.dynamicResolution;
    debugState.setting = settingOf();
    debugState.tier = quality.tier;
    debugState.hdr = quality.hdr ? '16F' : 'RGBA8';
  };

  const applySize = (): void => {
    const pixelRatio = Math.min(Math.max(dpr, 0.5), MAX_PIXEL_RATIO);
    three.setPixelRatio(pixelRatio);
    three.setSize(cssWidth, cssHeight, true);
    const scale = quality.baseScale * dynamicRes.scale;
    ctx.scale = scale;
    const w = Math.max(1, Math.round(cssWidth * pixelRatio * scale));
    const h = Math.max(1, Math.round(cssHeight * pixelRatio * scale));
    targets.resize(w, h);
    chain.resize(w, h, ctx);
    internalWidth = targets.width;
    internalHeight = targets.height;
    cameras.matrix.aspect = cssWidth / Math.max(cssHeight, 1);
    cameras.matrix.updateProjectionMatrix();
    cameras.hud.left = 0;
    cameras.hud.right = cssWidth;
    cameras.hud.top = cssHeight;
    cameras.hud.bottom = 0;
    cameras.hud.updateProjectionMatrix();
    debugState.scale = scale;
    debugState.dyn = dynamicRes.scale;
    debugState.size = `${internalWidth}×${internalHeight}`;
  };

  const unsub = opts.settings.onChange(() => {
    applyQuality();
    applySize();
  });

  const api: Renderer = {
    three,
    canvas: three.domElement,
    targets,
    chain,
    palette,
    dynamicRes,
    get quality() {
      return quality;
    },
    caps,
    scenes,
    cameras,
    get cssWidth() {
      return cssWidth;
    },
    get cssHeight() {
      return cssHeight;
    },
    get internalWidth() {
      return internalWidth;
    },
    get internalHeight() {
      return internalHeight;
    },
    get effectiveScale() {
      return quality.baseScale * dynamicRes.scale;
    },
    get postMode() {
      return postMode;
    },
    set postMode(mode) {
      postMode = mode;
    },
    get drawHdr() {
      return drawHdr;
    },
    set drawHdr(fn) {
      drawHdr = fn;
    },
    get pipEnabled() {
      return pipEnabled;
    },
    set pipEnabled(v) {
      pipEnabled = v;
    },
    get exposure() {
      return exposure;
    },
    set exposure(v) {
      exposure = v;
    },
    get gpuLoad() {
      return gpuLoad;
    },
    set gpuLoad(v) {
      gpuLoad = Math.max(0, Math.min(256, v));
    },
    setQuality(setting) {
      override = setting;
      applyQuality();
      applySize();
    },
    resize(nextW, nextH, nextDpr) {
      cssWidth = Math.max(1, nextW);
      cssHeight = Math.max(1, nextH);
      dpr = nextDpr;
      applySize();
    },
    endFrame(dt, gpuMs) {
      if (dt > 0 && dynamicRes.sample(gpuMs)) applySize();
      time += Math.max(0, dt);
      ctx.dt = dt;
      ctx.time = time;
      ctx.mode = postMode;
      ctx.exposure = exposure;
      ctx.quality = quality;

      cameras.matrix.getWorldQuaternion(scratchQuat);
      ctx.angularVelocity = dt > 1e-6 ? lastQuat.angleTo(scratchQuat) / dt : 0;
      lastQuat.copy(scratchQuat);

      if (gpuLoad > 0) {
        burnMat.uniforms.uIters!.value = gpuLoad;
        blitter.blit(three, burnMat, burnTarget);
      }

      const simstimLive = scenes.simstim.children.length > 0;
      if (simstimLive) {
        three.setRenderTarget(targets.simstim);
        three.clear(true, true, false);
        three.render(scenes.simstim, cameras.simstim);
      }

      const drawMatrix = postMode === 'matrix';
      three.setRenderTarget(targets.hdrScene);
      three.clear(true, true, false);
      if (drawHdr) {
        drawHdr(three, targets.hdrScene);
      } else {
        if (drawMatrix) {
          if (scenes.sky.children.length > 0) three.render(scenes.sky, cameras.matrix);
          if (scenes.matrix.children.length > 0) three.render(scenes.matrix, cameras.matrix);

          if (scenes.blackIce.children.length > 0) {
            three.setRenderTarget(targets.blackIceMask);
            three.clear(true, true, false);
            three.render(scenes.blackIce, cameras.matrix);
          }
        }

        if (scenes.hud.children.length > 0) {
          three.setRenderTarget(targets.hud);
          three.clear(true, true, false);
          three.render(scenes.hud, cameras.hud);
        }
      }

      chain.render(targets.hdrScene.texture, ctx);

      if (pipEnabled && simstimLive && postMode === 'matrix') {
        three.getDrawingBufferSize(drawingSize);
        const pw = Math.max(96, Math.round(drawingSize.x * 0.2));
        const ph = Math.round((pw * 240) / 320);
        const margin = Math.max(8, Math.round(drawingSize.x * 0.016));
        const vx = drawingSize.x - pw - margin;
        const vy = drawingSize.y - ph - margin;
        pipMat.uniforms.tInput!.value = targets.simstim.texture;
        three.setRenderTarget(null);
        three.setScissorTest(true);
        three.setViewport(vx, vy, pw, ph);
        three.setScissor(vx, vy, pw, ph);
        blitter.blit(three, pipMat, null);
        three.setScissorTest(false);
        three.setViewport(0, 0, drawingSize.x, drawingSize.y);
        three.setScissor(0, 0, drawingSize.x, drawingSize.y);
      }
      debugState.textures = three.info.memory.textures;
      debugState.dyn = dynamicRes.scale;
      debugState.scale = quality.baseScale * dynamicRes.scale;
      debugState.size = `${targets.width}×${targets.height}`;
    },
    info() {
      return {
        textures: three.info.memory.textures,
        geometries: three.info.memory.geometries,
        programs: three.info.programs?.length ?? 0,
        calls: three.info.render.calls,
        width: targets.width,
        height: targets.height,
      };
    },
    attachDebug(pane) {
      const folder = pane.addFolder({ title: 'graphics' });
      folder
        .addBinding(debugState, 'setting', {
          label: 'quality',
          options: { auto: 'auto', low: 'low', medium: 'medium', high: 'high' },
        })
        .on('change', (ev) => {
          const v = ev.value;
          if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') {
            api.setQuality(v);
          }
        });
      folder.addBinding(debugState, 'tier', { readonly: true });
      folder.addBinding(debugState, 'hdr', { readonly: true });
      folder.addBinding(debugState, 'size', { readonly: true, label: 'internal' });
      folder.addBinding(debugState, 'scale', {
        readonly: true,
        format: (n: number) => n.toFixed(2),
      });
      folder.addBinding(debugState, 'dyn', {
        readonly: true,
        label: 'dynres',
        format: (n: number) => n.toFixed(1),
      });
      folder.addBinding(debugState, 'textures', { readonly: true });
      const load = { gpuLoad: 0 };
      folder
        .addBinding(load, 'gpuLoad', { min: 0, max: 256, step: 8, label: 'GPU load' })
        .on('change', (ev) => {
          api.gpuLoad = Number(ev.value) || 0;
        });
      folder.addButton({ title: 'inject 20 ms GPU' }).on('click', () => dynamicRes.inject(20));
      folder.addButton({ title: 'clear GPU inject' }).on('click', () => dynamicRes.inject(null));
    },
    dispose() {
      unsub();
      chain.dispose();
      targets.dispose();
      blitter.dispose();
      burnTarget.dispose();
      burnMat.dispose();
      pipMat.dispose();
      palette.reset();
      three.dispose();
      three.domElement.remove();
    },
  };

  return api;
}
