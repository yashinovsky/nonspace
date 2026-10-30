import { createIdentityPass, type PostPass } from './pass';

/**
 * Raster / NTSC CRT (plan §8.4, §8.5). Owned by **M1.7**.
 *
 * Replace this file. Used for simstim and teletext interludes instead of
 * VectorCrtPass. Input is typically `ctx.targets.simstim` (320×240). Same
 * `ctx.encoded = 'ldr'` rule as the vector CRT once this pass tonemaps.
 */
export function createRasterCrtPass(): PostPass {
  return createIdentityPass('rasterCrt', 'crt', 'raster');
}
