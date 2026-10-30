import { Vector2, type ShaderMaterial, type Texture } from 'three';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import {
  NTSC_HEIGHT,
  NTSC_WIDTH,
  RASTER_CRT_DEFAULTS,
  RASTER_TRANSITION_DURATION,
  rasterTransitionAt,
  type RasterCrtParams,
  type RasterTransitionWeights,
} from './rasterCrt';
import rasterCrtFrag from './shaders/rasterCrt.frag?raw';

export interface RasterCrtPass extends PostPass {
  readonly params: RasterCrtParams;
  readonly transition: { playing: boolean; elapsed: number; duration: number };
  /**
   * Optional 320×240 (or any) source used instead of the chain `input`.
   * The Look Lab hangs the SMPTE card here so the pass does not need a
   * scene. Production simstim can leave this null and feed `input`.
   */
  source: Texture | null;
  playTransition(duration?: number): void;
  stopTransition(): void;
}

export function isRasterCrtPass(pass: PostPass): pass is RasterCrtPass {
  return pass.slot === 'crt' && pass.kind === 'raster' && 'playTransition' in pass;
}

/**
 * Raster / NTSC CRT (plan §8.4, §8.5, M1.7).
 *
 * Samples `source ?? input` as a 320×240 NTSC raster: RGB→YIQ, I/Q blur ≈ 4 px
 * > Y blur ≈ 1 px, scanlines, Trinitron aperture grille, interlace jitter,
 * stronger barrel, raised black, vignette, cheap bloom. Transition uniforms
 * are H-hold roll, static amount, tracking noise (0.3 s simstim flip).
 *
 * Tonemaps and sets `ctx.encoded = 'ldr'` so FinalComposite does not Reinhard
 * twice. Returns `input` unchanged when the chain's post target is a stub
 * (unit tests without WebGL). Typed as `PostPass` so PostChain can still swap
 * identity stubs; use `isRasterCrtPass` for the extra fields.
 */
export function createRasterCrtPass(): PostPass {
  const params: RasterCrtParams = { ...RASTER_CRT_DEFAULTS };
  const trans: RasterTransitionWeights = {
    hHold: 0,
    staticAmount: 0,
    tracking: 0,
    flicker: 0,
  };
  let material: ShaderMaterial | null = null;
  let source: Texture | null = null;
  let transElapsed = Infinity;
  let transDuration = RASTER_TRANSITION_DURATION;

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(rasterCrtFrag, {
      tInput: { value: null },
      uNtscSize: { value: new Vector2(NTSC_WIDTH, NTSC_HEIGHT) },
      uTime: { value: 0 },
      uHHold: { value: 0 },
      uStatic: { value: 0 },
      uTracking: { value: 0 },
      uBarrel: { value: params.barrel },
      uScanlines: { value: params.scanlines },
      uGrille: { value: params.grille },
      uVignette: { value: params.vignette },
      uBlackLift: { value: params.blackLift },
      uBloom: { value: params.bloom },
      uInterlace: { value: params.interlace },
      uFlicker: { value: 0 },
      uReduceFlashing: { value: 1 },
    });
    return material;
  };

  const pass: RasterCrtPass = {
    name: 'rasterCrt',
    slot: 'crt',
    kind: 'raster',
    params,
    get transition() {
      return {
        playing: transElapsed < transDuration,
        elapsed: transElapsed,
        duration: transDuration,
      };
    },
    get source() {
      return source;
    },
    set source(tex) {
      source = tex;
    },
    playTransition(duration = RASTER_TRANSITION_DURATION) {
      transDuration = Math.max(0.05, duration);
      transElapsed = 0;
    },
    stopTransition() {
      transElapsed = Infinity;
    },
    resize() {},
    render(input: Texture, ctx: PostContext) {
      const target = ctx.targets.post.write;
      if (!target?.texture) {
        ctx.encoded = 'ldr';
        return input;
      }

      if (transElapsed < transDuration) {
        rasterTransitionAt(transElapsed, transDuration, trans);
        transElapsed += Math.max(0, ctx.dt);
      } else {
        trans.hHold = 0;
        trans.staticAmount = 0;
        trans.tracking = 0;
        trans.flicker = 0;
      }

      const reduce = ctx.reduceFlashing ? 1 : 0;
      const motion = ctx.reduceMotion ? 0.25 : 1;
      const hHold = (params.hHold + trans.hHold) * motion;
      let staticAmt = params.staticAmount + trans.staticAmount;
      let flicker = trans.flicker;
      if (reduce > 0.5) {
        flicker = 0;
        staticAmt *= 0.25;
      }

      const mat = ensure();
      const u = mat.uniforms;
      u.tInput!.value = source ?? input;
      u.uTime!.value = ctx.time;
      u.uHHold!.value = hHold;
      u.uStatic!.value = staticAmt;
      u.uTracking!.value = params.tracking + trans.tracking;
      u.uBarrel!.value = params.barrel;
      u.uScanlines!.value = params.scanlines;
      u.uGrille!.value = params.grille;
      u.uVignette!.value = params.vignette;
      u.uBlackLift!.value = params.blackLift;
      u.uBloom!.value = params.bloom;
      u.uInterlace!.value = params.interlace;
      u.uFlicker!.value = flicker;
      u.uReduceFlashing!.value = reduce;

      ctx.blit(mat, target);
      ctx.encoded = 'ldr';
      return target.texture;
    },
    dispose() {
      material?.dispose();
      material = null;
      source = null;
    },
  };
  return pass;
}

export function asRasterCrtPass(pass: PostPass): RasterCrtPass {
  if (!isRasterCrtPass(pass)) throw new Error('expected RasterCrtPass');
  return pass;
}
