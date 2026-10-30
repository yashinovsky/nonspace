import type { Texture } from 'three';
import { createBlackIceComposite } from './BlackIceComposite';
import { createBloomPass } from './BloomPass';
import { createFinalComposite } from './FinalComposite';
import type { CrtKind, PostContext, PostMode, PostPass, PostSlot } from './pass';
import { createPersistencePass } from './PersistencePass';
import { createRasterCrtPass } from './RasterCrtPass';
import { createVectorCrtPass } from './VectorCrtPass';

export {
  createBlitter,
  createFullscreenMaterial,
  createIdentityPass,
  POST_SLOTS,
  type BlitFn,
  type Blitter,
  type ColorEncoding,
  type CrtKind,
  type PostContext,
  type PostMode,
  type PostPass,
  type PostSlot,
} from './pass';

/**
 * Runs the named post slots in order. Pass modules are imported here and only
 * here so M1 tasks replace `createXxxPass` in their own file and this wiring
 * keeps working.
 *
 * Beach skips CRT and goes straight to FinalComposite's tonemap.
 */
export interface PostChain {
  readonly vectorCrt: PostPass;
  readonly rasterCrt: PostPass;
  getPass(slot: PostSlot): PostPass;
  /** Replace a slot. Tests use this; M1 tasks edit their own file instead. */
  setPass(pass: PostPass): void;
  setCrt(kind: CrtKind, pass: PostPass): void;
  resize(width: number, height: number, ctx: PostContext): void;
  render(input: Texture, ctx: PostContext): void;
  dispose(): void;
}

const MATRIX_SLOTS: readonly PostSlot[] = ['persistence', 'bloom', 'blackIce', 'crt', 'final'];
const RASTER_SLOTS: readonly PostSlot[] = ['bloom', 'crt', 'final'];
const BEACH_SLOTS: readonly PostSlot[] = ['final'];

export function slotsFor(mode: PostMode): readonly PostSlot[] {
  if (mode === 'beach') return BEACH_SLOTS;
  if (mode === 'simstim' || mode === 'interlude') return RASTER_SLOTS;
  return MATRIX_SLOTS;
}

export function createPostChain(): PostChain {
  const slots: Record<PostSlot, PostPass> = {
    persistence: createPersistencePass(),
    bloom: createBloomPass(),
    blackIce: createBlackIceComposite(),
    crt: createVectorCrtPass(),
    final: createFinalComposite(),
  };
  let vectorCrt = slots.crt;
  let rasterCrt = createRasterCrtPass();

  const all = (): PostPass[] => [
    slots.persistence,
    slots.bloom,
    slots.blackIce,
    vectorCrt,
    rasterCrt,
    slots.final,
  ];

  const crtFor = (mode: PostMode): PostPass | null => {
    if (mode === 'beach') return null;
    if (mode === 'simstim' || mode === 'interlude') return rasterCrt;
    return vectorCrt;
  };

  const chain: PostChain = {
    get vectorCrt() {
      return vectorCrt;
    },
    get rasterCrt() {
      return rasterCrt;
    },
    getPass(slot) {
      return slots[slot];
    },
    setPass(pass) {
      if (pass.slot === 'crt') {
        chain.setCrt(pass.kind === 'raster' ? 'raster' : 'vector', pass);
        return;
      }
      slots[pass.slot]?.dispose();
      slots[pass.slot] = pass;
    },
    setCrt(kind, pass) {
      if (kind === 'raster') {
        rasterCrt.dispose();
        rasterCrt = pass;
      } else {
        vectorCrt.dispose();
        vectorCrt = pass;
        slots.crt = pass;
      }
    },
    resize(width, height, ctx) {
      for (const pass of all()) pass.resize(width, height, ctx);
    },
    render(input, ctx) {
      ctx.hdr = input;
      ctx.combined = input;
      ctx.bloom = null;
      ctx.encoded = 'hdr';
      let tex = input;
      for (const slot of slotsFor(ctx.mode)) {
        const pass = slot === 'crt' ? crtFor(ctx.mode) : slots[slot];
        if (!pass) continue;
        tex = pass.render(tex, ctx);
        if (slot === 'persistence') ctx.combined = tex;
      }
    },
    dispose() {
      for (const pass of all()) pass.dispose();
    },
  };
  return chain;
}
