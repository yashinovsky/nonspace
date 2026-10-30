/// <reference types="vite-plugin-glsl/ext" />
import { Vector3, type ShaderMaterial, type Texture } from 'three';
import { Beam } from '../lines/BeamBatch';
import { BEAM_HEX, hexToRgb } from '../palette';
import type { PingPong } from '../targets';
import { createFullscreenMaterial, type PostContext, type PostPass } from './pass';
import persistenceFrag from './shaders/persistence.frag';

/**
 * Phosphor persistence (plan §8.4, §8.5, M1.4). P7 radar: moving geometry
 * leaves trails that decay blue-white → yellow-green. Buffers are
 * `ctx.targets.persist` (allocated in M0.4). Skip (return `input`) when
 * `ctx.quality.persistence` is false or Reduce Motion is on so Low / comfort
 * do not run the pass.
 */

/** Per-1/60s RGB keep factors from §8.5. Blue decays fastest. */
export const PERSIST_KEEP = [0.9, 0.93, 0.78] as const;

/** Hue mix of decayed energy toward palette AFTERGLOW. */
export const DEFAULT_PERSIST_SHIFT = 0.55;

/** rad/s. Camera turns faster than this boost decay (anti-smear). */
export const DEFAULT_SMEAR_THRESHOLD = 0.7;

export const DEFAULT_SMEAR_STRENGTH = 1.25;

const AFTERGLOW = hexToRgb(BEAM_HEX[Beam.AFTERGLOW]!);

export interface PersistencePass extends PostPass {
  /** 1 = nominal. `<1` lengthens (jump streak); `0` freezes; `>1` shortens. */
  decayScale: number;
  /** 0 = no hue shift; 1 = decayed energy is AFTERGLOW. */
  shift: number;
  /** rad/s. Angular velocity above this boosts decay. */
  smearThreshold: number;
  smearStrength: number;
  clear(ctx: PostContext): void;
}

export function persistDecayExponent(
  dt: number,
  angularVelocity: number,
  decayScale: number,
  smearThreshold = DEFAULT_SMEAR_THRESHOLD,
  smearStrength = DEFAULT_SMEAR_STRENGTH,
): number {
  const boost = 1 + Math.max(0, angularVelocity - smearThreshold) * smearStrength;
  return Math.max(0, dt) * 60 * Math.max(0, decayScale) * boost;
}

export function persistKeep(exponent: number): [number, number, number] {
  return [PERSIST_KEEP[0] ** exponent, PERSIST_KEEP[1] ** exponent, PERSIST_KEEP[2] ** exponent];
}

function persistPair(ctx: PostContext): PingPong | null {
  const persist = ctx.targets.persist;
  if (!persist?.read || !persist.write) return null;
  return persist;
}

function isActive(ctx: PostContext): boolean {
  return ctx.quality.persistence && !ctx.reduceMotion && persistPair(ctx) !== null;
}

function clearPersist(ctx: PostContext): void {
  const persist = persistPair(ctx);
  if (!persist) return;
  const r = ctx.renderer;
  if (typeof r.setRenderTarget !== 'function' || typeof r.clear !== 'function') return;
  const prev = r.getRenderTarget();
  r.setRenderTarget(persist.read);
  r.clear(true, false, false);
  r.setRenderTarget(persist.write);
  r.clear(true, false, false);
  r.setRenderTarget(prev);
}

export function createPersistencePass(): PersistencePass {
  let material: ShaderMaterial | null = null;
  let armed = false;
  const afterglow = new Vector3(AFTERGLOW.r, AFTERGLOW.g, AFTERGLOW.b);

  const ensure = (): ShaderMaterial => {
    material ??= createFullscreenMaterial(persistenceFrag, {
      tCurrent: { value: null },
      tPrev: { value: null },
      uDt: { value: 0 },
      uDecayScale: { value: 1 },
      uOmega: { value: 0 },
      uSmearThreshold: { value: DEFAULT_SMEAR_THRESHOLD },
      uSmearStrength: { value: DEFAULT_SMEAR_STRENGTH },
      uAfterglow: { value: afterglow },
      uShift: { value: DEFAULT_PERSIST_SHIFT },
    });
    return material;
  };

  const pass: PersistencePass = {
    name: 'persistence',
    slot: 'persistence',
    decayScale: 1,
    shift: DEFAULT_PERSIST_SHIFT,
    smearThreshold: DEFAULT_SMEAR_THRESHOLD,
    smearStrength: DEFAULT_SMEAR_STRENGTH,
    resize(_width, _height, ctx) {
      clearPersist(ctx);
      armed = false;
    },
    clear(ctx) {
      clearPersist(ctx);
      armed = false;
    },
    render(input: Texture, ctx: PostContext) {
      const persist = persistPair(ctx);
      if (!persist || !isActive(ctx)) {
        if (armed) {
          clearPersist(ctx);
          armed = false;
        }
        return input;
      }
      if (!armed) {
        clearPersist(ctx);
        armed = true;
      }
      const mat = ensure();
      const u = mat.uniforms;
      u.tCurrent!.value = input;
      u.tPrev!.value = persist.read.texture;
      u.uDt!.value = ctx.dt;
      u.uDecayScale!.value = pass.decayScale;
      u.uOmega!.value = ctx.angularVelocity;
      u.uSmearThreshold!.value = pass.smearThreshold;
      u.uSmearStrength!.value = pass.smearStrength;
      u.uShift!.value = pass.shift;
      ctx.blit(mat, persist.write);
      persist.swap();
      return persist.read.texture;
    },
    dispose() {
      material?.dispose();
      material = null;
      armed = false;
    },
  };
  return pass;
}
