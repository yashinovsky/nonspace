import {
  GLSL3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Material,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { QualityConfig } from '../quality';
import type { RenderTargets } from '../targets';

const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Named slots in the matrix post chain (plan §8.4). Each slot is a file so
 * M1.4–M1.8 can land in parallel: they replace their own pass module and
 * never need to touch siblings. See PostChain.ts for wiring.
 *
 *   persistence  PersistencePass.ts     M1.4
 *   bloom        BloomPass.ts           M1.5
 *   blackIce     BlackIceComposite.ts   M1.8
 *   crt          VectorCrtPass.ts       M1.6  (matrix)
 *                RasterCrtPass.ts       M1.7  (simstim / interlude)
 *   final        FinalComposite.ts      M0.4  (HUD overlay later)
 */
export const POST_SLOTS = ['persistence', 'bloom', 'blackIce', 'crt', 'final'] as const;
export type PostSlot = (typeof POST_SLOTS)[number];

export type PostMode = 'matrix' | 'simstim' | 'interlude' | 'beach';
export type CrtKind = 'vector' | 'raster';
export type ColorEncoding = 'hdr' | 'ldr';

export interface Blitter {
  blit(renderer: WebGLRenderer, material: Material, target: WebGLRenderTarget | null): void;
  dispose(): void;
}

/** Bound blit used by passes: write `material` into `target` (null = backbuffer). */
export type BlitFn = (material: Material, target: WebGLRenderTarget | null) => void;

export interface PostContext {
  readonly renderer: WebGLRenderer;
  readonly targets: RenderTargets;
  readonly blit: BlitFn;
  quality: QualityConfig;
  /** Combined quality.baseScale * dynamicRes.scale. */
  scale: number;
  dt: number;
  time: number;
  mode: PostMode;
  /** rad/s of the matrix camera; persistence uses this for anti-smear. */
  angularVelocity: number;
  reduceFlashing: boolean;
  reduceMotion: boolean;
  /** Scene HDR (pre-post). */
  hdr: Texture;
  /** After persistence (aliases hdr when the pass is off / identity). */
  combined: Texture;
  /** Bloom-only buffer. Null until M1.5 writes it. Black ICE adds this. */
  bloom: Texture | null;
  /**
   * `hdr` until a CRT pass tonemaps. FinalComposite tonemaps only when this
   * is still `hdr`, so M1.6 can take over by writing LDR and flipping it.
   */
  encoded: ColorEncoding;
  /** Wintermute exposure hook (plan §8.5). 1 = nominal. */
  exposure: number;
  /** Vector-load metric for CRT flicker (M1.6). */
  vectorLoad: number;
}

export interface PostPass {
  readonly name: string;
  readonly slot: PostSlot;
  /** Vector vs raster CRT share the `crt` slot; ignored on other slots. */
  readonly kind?: CrtKind;
  resize(width: number, height: number, ctx: PostContext): void;
  /**
   * Read `input`, write any outputs, return the texture the next slot should
   * sample. Identity / disabled passes MUST return `input` unchanged and
   * allocate nothing.
   */
  render(input: Texture, ctx: PostContext): Texture;
  dispose(): void;
}

export function createFullscreenMaterial(
  fragmentShader: string,
  uniforms: ShaderMaterial['uniforms'],
): ShaderMaterial {
  return new ShaderMaterial({
    name: 'fullscreen',
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

export function createBlitter(): Blitter {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new Scene();
  const mesh = new Mesh(new PlaneGeometry(2, 2));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  return {
    blit(renderer, material, target) {
      mesh.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    dispose() {
      mesh.geometry.dispose();
      scene.remove(mesh);
    },
  };
}

export function createIdentityPass(name: string, slot: PostSlot, kind?: CrtKind): PostPass {
  return {
    name,
    slot,
    kind,
    resize() {},
    render(input) {
      return input;
    },
    dispose() {},
  };
}
