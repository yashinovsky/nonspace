import { createIdentityPass, type PostContext, type PostPass } from './pass';

/**
 * Dual-filter bloom + halation (plan §8.4, §8.5). Owned by **M1.5**.
 *
 * Replace this file. Write the bloom-only texture to `ctx.bloom` and return
 * `combined` unchanged — BlackIceComposite adds bloom so this pass and M1.8
 * don't share an output buffer. Own the mip chain inside this module
 * (`createColorTarget` from `render/targets.ts`); mip count is
 * `ctx.quality.bloomMips`.
 */
export function createBloomPass(): PostPass {
  const pass = createIdentityPass('bloom', 'bloom');
  return {
    ...pass,
    render(input, ctx: PostContext) {
      ctx.bloom = null;
      return input;
    },
  };
}
