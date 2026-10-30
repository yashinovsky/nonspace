/**
 * Shared low-poly kit for simstim interiors (M6.2 / M6.3). Boxes and planes
 * only — no glTF. Materials come from the M6.1 flat-dither factory; this
 * module does not own shaders.
 */
import { Group, Mesh, type Material, type Object3D } from 'three';
import type { BoxGeometry, PlaneGeometry } from 'three';

export const TRI_BOX = 12;
export const TRI_PLANE = 2;
/** Head + torso + 2 legs + 2 arms. */
export const TRI_MANNEQUIN = 6 * TRI_BOX;
/** Shoulder blob + torso slab. */
export const TRI_CROWD = 2 * TRI_BOX;
/** Two posts, lintel, haunch. */
export const TRI_ARCH = 4 * TRI_BOX;
/** Pedestal, skull, jaw, eyes, lapis, pearls. */
export const TRI_CAMEO = 14 * TRI_BOX;
export const SCENE_TRI_CAP = 3_000;

export type SimstimZone =
  'lobby' | 'corridor' | 'vault' | 'hall' | 'stair' | 'gallery' | 'head' | 'other';

export type MannequinKind = 'guard' | 'jane' | 'hideo' | 'riviera';

export interface ZoneStats {
  lobby: number;
  corridor: number;
  vault: number;
  hall: number;
  stair: number;
  gallery: number;
  head: number;
  other: number;
}

export function emptyZoneStats(): ZoneStats {
  return {
    lobby: 0,
    corridor: 0,
    vault: 0,
    hall: 0,
    stair: 0,
    gallery: 0,
    head: 0,
    other: 0,
  };
}

export function zoneTotal(stats: ZoneStats): number {
  return (
    stats.lobby +
    stats.corridor +
    stats.vault +
    stats.hall +
    stats.stair +
    stats.gallery +
    stats.head +
    stats.other
  );
}

export interface KitOptions {
  root: Object3D;
  figures: Map<string, Object3D>;
  boxGeom: BoxGeometry;
  planeGeom: PlaneGeometry;
  material: (hex: number, ambient?: number) => Material;
}

export interface SimstimKit {
  readonly root: Object3D;
  readonly figures: Map<string, Object3D>;
  readonly alarms: Mesh[];
  readonly stats: ZoneStats;
  beginZone(zone: SimstimZone): void;
  box(
    hex: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    parent?: Object3D,
    ambient?: number,
  ): Mesh;
  plane(
    hex: number,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    rotX: number,
    rotY?: number,
    parent?: Object3D,
  ): Mesh;
  mannequin(
    id: string,
    x: number,
    y: number,
    z: number,
    yaw?: number,
    kind?: MannequinKind,
    parent?: Object3D,
  ): Group;
  arch(
    hex: number,
    x: number,
    z: number,
    span: number,
    height: number,
    depth?: number,
    parent?: Object3D,
  ): Group;
  stairs(
    hex: number,
    x: number,
    z: number,
    steps: number,
    width: number,
    rise: number,
    run: number,
    parent?: Object3D,
  ): Group;
  cameo(id: string, x: number, y: number, z: number, parent?: Object3D): Group;
  crowd(id: string, hex: number, x: number, y: number, z: number, parent?: Object3D): Group;
  alarm(hex: number, x: number, y: number, z: number, parent?: Object3D): Mesh;
}

export function createSimstimKit(opts: KitOptions): SimstimKit {
  const cache = new Map<string, Material>();
  const alarms: Mesh[] = [];
  const stats = emptyZoneStats();
  let zone: SimstimZone = 'other';

  const mat = (hex: number, ambient?: number): Material => {
    const key = `${hex.toString(16)}:${ambient ?? ''}`;
    let m = cache.get(key);
    if (!m) {
      m = opts.material(hex, ambient);
      cache.set(key, m);
    }
    return m;
  };

  const add = (n: number): void => {
    stats[zone] += n;
  };

  const kit: SimstimKit = {
    root: opts.root,
    figures: opts.figures,
    alarms,
    stats,
    beginZone(next) {
      zone = next;
    },
    box(hex, w, h, d, x, y, z, parent = opts.root, ambient) {
      const mesh = new Mesh(opts.boxGeom, mat(hex, ambient));
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      add(TRI_BOX);
      return mesh;
    },
    plane(hex, w, h, x, y, z, rotX, rotY = 0, parent = opts.root) {
      const mesh = new Mesh(opts.planeGeom, mat(hex, 0.78));
      mesh.scale.set(w, h, 1);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rotX;
      mesh.rotation.y = rotY;
      parent.add(mesh);
      add(TRI_PLANE);
      return mesh;
    },
    mannequin(id, x, y, z, yaw = 0, kind = 'guard', parent = opts.root) {
      const g = makeMannequin(opts.boxGeom, mat, kind);
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      parent.add(g);
      opts.figures.set(id, g);
      add(TRI_MANNEQUIN);
      return g;
    },
    arch(hex, x, z, span, height, depth = 0.42, parent = opts.root) {
      const g = new Group();
      g.position.set(x, 0, z);
      parent.add(g);
      const post = 0.28;
      const postH = height;
      kit.box(hex, post, postH, depth, -span / 2, postH / 2, 0, g);
      kit.box(hex, post, postH, depth, span / 2, postH / 2, 0, g);
      kit.box(hex, span + post, 0.26, depth, 0, height + 0.08, 0, g);
      kit.box(hex, span * 0.42, 0.2, depth * 0.9, 0, height - 0.18, 0, g);
      return g;
    },
    stairs(hex, x, z, steps, width, rise, run, parent = opts.root) {
      const g = new Group();
      g.position.set(x, 0, z);
      parent.add(g);
      const n = Math.max(1, Math.floor(steps));
      for (let i = 0; i < n; i++) {
        kit.box(hex, width, rise, run, 0, rise * (i + 0.5), -run * i, g);
      }
      return g;
    },
    cameo(id, x, y, z, parent = opts.root) {
      const g = makeCameo(kit, parent);
      g.position.set(x, y, z);
      opts.figures.set(id, g);
      return g;
    },
    crowd(id, hex, x, y, z, parent = opts.root) {
      const g = new Group();
      g.position.set(x, y, z);
      g.visible = false;
      parent.add(g);
      kit.box(hex, 0.52, 0.7, 0.28, 0, 1.05, 0, g);
      kit.box(hex, 0.36, 0.32, 0.3, 0, 1.52, 0.02, g);
      opts.figures.set(id, g);
      return g;
    },
    alarm(hex, x, y, z, parent = opts.root) {
      const mesh = kit.box(hex, 0.22, 0.22, 0.1, x, y, z, parent);
      alarms.push(mesh);
      return mesh;
    },
  };
  return kit;
}

const MANNEQUIN_COLORS: Record<MannequinKind, readonly [number, number, number, number]> = {
  guard: [0xe8b888, 0x5a7a8c, 0x4a4854, 0x4a6a48],
  jane: [0xf4ece0, 0xe4dcd0, 0xb88858, 0xe8b888],
  hideo: [0xe8b888, 0x2a2830, 0x2a2830, 0x4a4854],
  riviera: [0xe8b888, 0xb88858, 0x4a4854, 0xe8a010],
};

function makeMannequin(
  geom: BoxGeometry,
  mat: (hex: number, ambient?: number) => Material,
  kind: MannequinKind,
): Group {
  const g = new Group();
  const [head, torso, legs, arms] = MANNEQUIN_COLORS[kind];
  const part = (hex: number, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(geom, mat(hex));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  part(head, 0.38, 0.42, 0.32, 0, 1.55, 0);
  part(torso, 0.55, 0.7, 0.28, 0, 1.05, 0);
  part(legs, 0.18, 0.55, 0.18, -0.22, 0.4, 0);
  part(legs, 0.18, 0.55, 0.18, 0.22, 0.4, 0);
  part(arms, 0.16, 0.55, 0.16, -0.38, 1.05, 0);
  part(arms, 0.16, 0.55, 0.16, 0.38, 1.05, 0);
  return g;
}

/** Platinum skull, ruby eyes, lapis inlay, pearl crust — boxes only. */
function makeCameo(kit: SimstimKit, parent: Object3D): Group {
  const g = new Group();
  parent.add(g);
  const PLAT = 0xa0b8c0;
  const PEARL = 0xf4ece0;
  const LAPIS = 0x3a4c5c;
  const RUBY = 0xc03028;
  const WOOD = 0x6a4c38;
  kit.box(WOOD, 0.7, 0.22, 0.7, 0, 0.11, 0, g);
  kit.box(PLAT, 0.22, 0.35, 0.22, 0, 0.4, 0, g);
  kit.box(PLAT, 0.55, 0.58, 0.48, 0, 0.92, 0.02, g, 0.95);
  kit.box(PLAT, 0.42, 0.18, 0.36, 0, 0.58, 0.06, g);
  kit.box(RUBY, 0.1, 0.1, 0.08, -0.12, 0.98, 0.26, g, 1.2);
  kit.box(RUBY, 0.1, 0.1, 0.08, 0.12, 0.98, 0.26, g, 1.2);
  kit.box(LAPIS, 0.18, 0.12, 0.08, 0, 0.78, 0.26, g, 0.9);
  kit.box(LAPIS, 0.5, 0.08, 0.08, 0, 1.18, 0.08, g);
  kit.box(PEARL, 0.12, 0.12, 0.12, -0.22, 1.22, 0.08, g, 1.05);
  kit.box(PEARL, 0.12, 0.12, 0.12, 0.22, 1.22, 0.08, g, 1.05);
  kit.box(PEARL, 0.1, 0.1, 0.1, 0, 1.28, -0.12, g, 1.05);
  kit.box(PEARL, 0.1, 0.08, 0.1, -0.18, 1.08, -0.16, g, 1.0);
  kit.box(PEARL, 0.1, 0.08, 0.1, 0.18, 1.08, -0.16, g, 1.0);
  kit.box(PLAT, 0.08, 0.22, 0.28, 0, 0.72, 0.28, g);
  return g;
}
