import { createIdentityPass, type PostPass } from './pass';

/**
 * Phosphor persistence (plan §8.4, §8.5). Owned by **M1.4**.
 *
 * Replace this file with the real ping-pong decay. Buffers are already
 * `ctx.targets.persist`. Skip the pass (return `input`) when
 * `ctx.quality.persistence` is false so Low / Reduce Motion allocate nothing.
 */
export function createPersistencePass(): PostPass {
  return createIdentityPass('persistence', 'persistence');
}
