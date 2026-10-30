import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

export const SIMSTIM_WIDTH = 320;
export const SIMSTIM_HEIGHT = 240;

export interface ColorTargetOpts {
  hdr: boolean;
  depth?: boolean;
  /** Nearest sampling (masks). Default linear. */
  nearest?: boolean;
}

/**
 * Shared color RT factory so M1 passes allocate extra buffers in the same
 * format as the chain without editing this file.
 */
export function createColorTarget(
  width: number,
  height: number,
  opts: ColorTargetOpts,
): WebGLRenderTarget {
  const filter = opts.nearest ? NearestFilter : LinearFilter;
  return new WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: opts.hdr ? HalfFloatType : UnsignedByteType,
    format: RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    generateMipmaps: false,
    depthBuffer: opts.depth === true,
    stencilBuffer: false,
    colorSpace: LinearSRGBColorSpace,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
}

export function createMaskTarget(width: number, height: number): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: UnsignedByteType,
    format: RedFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
    colorSpace: NoColorSpace,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
}

export interface PingPong {
  read: WebGLRenderTarget;
  write: WebGLRenderTarget;
  swap(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** Bind two existing targets as a ping-pong pair. `swap` does not allocate. */
export function bindPingPong(a: WebGLRenderTarget, b: WebGLRenderTarget): PingPong {
  let read = a;
  let write = b;
  return {
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      const tmp = read;
      read = write;
      write = tmp;
    },
    resize(width, height) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      a.setSize(w, h);
      b.setSize(w, h);
    },
    dispose() {
      a.dispose();
      b.dispose();
    },
  };
}

export function createPingPong(width: number, height: number, opts: ColorTargetOpts): PingPong {
  return bindPingPong(
    createColorTarget(width, height, opts),
    createColorTarget(width, height, opts),
  );
}

export interface RenderTargets {
  readonly hdr: boolean;
  readonly width: number;
  readonly height: number;
  /** Matrix/sky/beach color + depth. */
  readonly hdrScene: WebGLRenderTarget;
  /** Black ICE coverage (R8). M1.8 writes this. */
  readonly blackIceMask: WebGLRenderTarget;
  /** Vector HUD. M3.2 writes this; FinalComposite overlays it after CRT. */
  readonly hud: WebGLRenderTarget;
  /** 320×240 simstim / raster source. */
  readonly simstim: WebGLRenderTarget;
  /** Fullscreen chain ping-pong (no depth). */
  readonly post: PingPong;
  /** Persistence A/B. M1.4 owns the shader; the buffers live here so it need not edit this file. */
  readonly persist: PingPong;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createRenderTargets(width: number, height: number, hdr: boolean): RenderTargets {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const color = { hdr };
  const hdrScene = createColorTarget(w, h, { ...color, depth: true });
  const blackIceMask = createMaskTarget(w, h);
  const hud = createColorTarget(w, h, color);
  const simstim = createColorTarget(SIMSTIM_WIDTH, SIMSTIM_HEIGHT, { hdr: false });
  const post = createPingPong(w, h, color);
  const persist = createPingPong(w, h, color);

  let curW = w;
  let curH = h;

  return {
    hdr,
    get width() {
      return curW;
    },
    get height() {
      return curH;
    },
    hdrScene,
    blackIceMask,
    hud,
    simstim,
    post,
    persist,
    resize(nextW, nextH) {
      const rw = Math.max(1, Math.floor(nextW));
      const rh = Math.max(1, Math.floor(nextH));
      if (rw === curW && rh === curH) return;
      curW = rw;
      curH = rh;
      hdrScene.setSize(rw, rh);
      blackIceMask.setSize(rw, rh);
      hud.setSize(rw, rh);
      post.resize(rw, rh);
      persist.resize(rw, rh);
    },
    dispose() {
      hdrScene.dispose();
      blackIceMask.dispose();
      hud.dispose();
      simstim.dispose();
      post.dispose();
      persist.dispose();
    },
  };
}

/** True when the GL context advertises a float/half-float color-buffer extension. */
export function hasHdrColorBuffer(gl: { getExtension(name: string): unknown }): boolean {
  return !!(
    gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')
  );
}

/**
 * True when a 1×1 RGBA16F target is a complete framebuffer. Call once after
 * constructing the WebGLRenderer. Falls back to RGBA8 when this is false.
 */
export function probeHdr(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (!hasHdrColorBuffer(gl)) return false;

  const rt = createColorTarget(1, 1, { hdr: true, depth: false });
  try {
    renderer.setRenderTarget(rt);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    renderer.setRenderTarget(null);
    return status === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return false;
  } finally {
    rt.dispose();
    renderer.setRenderTarget(null);
  }
}

export function readGpuRendererName(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) {
    const name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof name === 'string' && name.length > 0) return name;
  }
  const fallback = gl.getParameter(gl.RENDERER);
  return typeof fallback === 'string' ? fallback : '';
}
