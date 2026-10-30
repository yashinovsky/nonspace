/**
 * Plain-data vector used by contracts (events, content, render push APIs).
 * THREE.Vector3 satisfies it structurally, so hot paths can pass reused
 * Vector3 instances without allocating.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}
