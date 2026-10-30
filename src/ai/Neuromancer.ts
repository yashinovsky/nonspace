import type { Vec3 } from '../core/math/vec3';

/**
 * Neuromancer behaviors from plan §3.8. The plan names the type but not its
 * shape; this union is provisional and owned by M7.3.
 */
export type NeuromancerAction =
  | { kind: 'soften'; amount: number }
  | { kind: 'pull'; target: Vec3 | null; strength: number }
  | { kind: 'beach' };
