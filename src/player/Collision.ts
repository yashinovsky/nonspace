/**
 * Soft hull collision for matrix flight (plan §3.3).
 *
 * Constructs and ICE have bounding volumes. The player cannot enter one
 * without breaching. Within `hullSpringRadius` (20 u) a spring pushes them
 * out; contact with an ICE hull is reported so Trace can accrue later.
 *
 * No allocations in `sample` / `resolve`. Geometry is spheres and AABBs until
 * M2.1 hands us authored hulls.
 */

export type HullKind = 'construct' | 'ice';

export type HullShape =
  | { type: 'sphere'; x: number; y: number; z: number; radius: number }
  | {
      type: 'aabb';
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
    };

export interface Hull {
  readonly id: string;
  readonly kind: HullKind;
  readonly shape: HullShape;
}

export interface CollisionHit {
  hit: boolean;
  inside: boolean;
  ice: boolean;
  hullId: string;
  kind: HullKind | '';
  nx: number;
  ny: number;
  nz: number;
  /** Signed distance from the player point to the hull surface. Negative = inside. */
  gap: number;
  /** 0 at the spring radius, 1 at the surface, >1 inside. */
  flare: number;
}

const EMPTY_ID = '';

export function emptyHit(out: CollisionHit): CollisionHit {
  out.hit = false;
  out.inside = false;
  out.ice = false;
  out.hullId = EMPTY_ID;
  out.kind = '';
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  out.gap = Infinity;
  out.flare = 0;
  return out;
}

export function createHit(): CollisionHit {
  return emptyHit({
    hit: false,
    inside: false,
    ice: false,
    hullId: EMPTY_ID,
    kind: '',
    nx: 0,
    ny: 1,
    nz: 0,
    gap: Infinity,
    flare: 0,
  });
}

export function sphereHull(
  id: string,
  kind: HullKind,
  x: number,
  y: number,
  z: number,
  radius: number,
): Hull {
  return { id, kind, shape: { type: 'sphere', x, y, z, radius } };
}

export function aabbHull(
  id: string,
  kind: HullKind,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Hull {
  return { id, kind, shape: { type: 'aabb', minX, minY, minZ, maxX, maxY, maxZ } };
}

/** Closest-point query against one hull. Writes `out` and returns it. */
export function queryHull(
  px: number,
  py: number,
  pz: number,
  hull: Hull,
  out: CollisionHit,
): CollisionHit {
  const s = hull.shape;
  if (s.type === 'sphere') {
    const dx = px - s.x;
    const dy = py - s.y;
    const dz = pz - s.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    let dist = Math.sqrt(d2);
    if (dist < 1e-8) {
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      dist = 0;
    } else {
      const inv = 1 / dist;
      out.nx = dx * inv;
      out.ny = dy * inv;
      out.nz = dz * inv;
    }
    out.gap = dist - s.radius;
  } else {
    const cx = px < s.minX ? s.minX : px > s.maxX ? s.maxX : px;
    const cy = py < s.minY ? s.minY : py > s.maxY ? s.maxY : py;
    const cz = pz < s.minZ ? s.minZ : pz > s.maxZ ? s.maxZ : pz;
    const inside =
      px >= s.minX && px <= s.maxX && py >= s.minY && py <= s.maxY && pz >= s.minZ && pz <= s.maxZ;
    if (inside) {
      const dxL = px - s.minX;
      const dxR = s.maxX - px;
      const dyL = py - s.minY;
      const dyR = s.maxY - py;
      const dzL = pz - s.minZ;
      const dzR = s.maxZ - pz;
      let best = dxL;
      out.nx = -1;
      out.ny = 0;
      out.nz = 0;
      if (dxR < best) {
        best = dxR;
        out.nx = 1;
        out.ny = 0;
        out.nz = 0;
      }
      if (dyL < best) {
        best = dyL;
        out.nx = 0;
        out.ny = -1;
        out.nz = 0;
      }
      if (dyR < best) {
        best = dyR;
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
      }
      if (dzL < best) {
        best = dzL;
        out.nx = 0;
        out.ny = 0;
        out.nz = -1;
      }
      if (dzR < best) {
        best = dzR;
        out.nx = 0;
        out.ny = 0;
        out.nz = 1;
      }
      out.gap = -best;
    } else {
      const dx = px - cx;
      const dy = py - cy;
      const dz = pz - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(d2);
      if (dist < 1e-8) {
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
        out.gap = 0;
      } else {
        const inv = 1 / dist;
        out.nx = dx * inv;
        out.ny = dy * inv;
        out.nz = dz * inv;
        out.gap = dist;
      }
    }
  }
  out.hit = true;
  out.inside = out.gap < 0;
  out.ice = hull.kind === 'ice';
  out.hullId = hull.id;
  out.kind = hull.kind;
  out.flare = 0;
  return out;
}

export interface CollisionWorld {
  readonly hulls: readonly Hull[];
  add(hull: Hull): void;
  remove(id: string): void;
  clear(): void;
  /**
   * Closest hull (smallest gap). If none, `out.hit` is false and `gap` is +Infinity.
   * Reuses `out` and an internal scratch hit — no allocations.
   */
  sample(px: number, py: number, pz: number, out: CollisionHit): CollisionHit;
}

export function createCollisionWorld(initial: readonly Hull[] = []): CollisionWorld {
  const hulls: Hull[] = initial.slice();
  const scratch = createHit();

  return {
    get hulls() {
      return hulls;
    },
    add(hull) {
      const i = hulls.findIndex((h) => h.id === hull.id);
      if (i >= 0) hulls[i] = hull;
      else hulls.push(hull);
    },
    remove(id) {
      const i = hulls.findIndex((h) => h.id === id);
      if (i >= 0) hulls.splice(i, 1);
    },
    clear() {
      hulls.length = 0;
    },
    sample(px, py, pz, out) {
      emptyHit(out);
      for (let i = 0; i < hulls.length; i++) {
        queryHull(px, py, pz, hulls[i]!, scratch);
        if (scratch.gap < out.gap) {
          out.hit = true;
          out.inside = scratch.inside;
          out.ice = scratch.ice;
          out.hullId = scratch.hullId;
          out.kind = scratch.kind;
          out.nx = scratch.nx;
          out.ny = scratch.ny;
          out.nz = scratch.nz;
          out.gap = scratch.gap;
        }
      }
      return out;
    },
  };
}
