import { createIdentityPass, type PostPass } from './pass';

/**
 * Vector CRT (plan §8.4, §8.5). Owned by **M1.6** (tonemap stub shared with M1.5).
 *
 * Replace this file. When this pass tonemaps, set `ctx.encoded = 'ldr'` so
 * FinalComposite does not apply Reinhard a second time. Effects (barrel,
 * jitter, flicker, vignette, glass, grain) should each be toggleable. Flicker
 * amplitude must be 0 when `ctx.reduceFlashing` is on.
 */
export function createVectorCrtPass(): PostPass {
  return createIdentityPass('vectorCrt', 'crt', 'vector');
}
