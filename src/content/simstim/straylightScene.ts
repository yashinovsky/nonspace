/**
 * Procedural Villa Straylight interiors (M6.3). Ornate as abstraction:
 * marble boxes, emerald arches, a stairwell, hologram slabs, the cameo
 * head as an emissive low-poly object. I, Robot / 1984 broadcast — not a
 * later-cyberpunk penthouse. One connected walk: hall → stair → gallery →
 * head. Each zone ≤ ~3k tris.
 */
import type { SimstimKit } from '../../render/simstim/kit';

const FLOOR = 0xe4dcd0;
const CEIL = 0x7a7680;
const WALL = 0xb0aaa2;
const EMERALD = 0x4a6a48;
const GOLD = 0xb88858;
const AMBER = 0xe8a010;
const CREAM = 0xf4ece0;
const DARK = 0x2a2830;
const WOOD = 0x6a4c38;
const COOL = 0x5a7a8c;
const LAPIS = 0x3a4c5c;
const PEARL = 0xe4dcd0;

export function buildStraylight(kit: SimstimKit): void {
  buildHall(kit);
  buildStair(kit);
  buildGallery(kit);
  buildHead(kit);
}

function buildHall(kit: SimstimKit): void {
  kit.beginZone('hall');
  kit.plane(FLOOR, 14, 14, 0, 0, -2.5, -Math.PI / 2);
  kit.plane(CEIL, 14, 14, 0, 4.8, -2.5, Math.PI / 2);
  kit.plane(WALL, 14, 4.8, -7, 2.4, -2.5, 0, Math.PI / 2);
  kit.plane(WALL, 14, 4.8, 7, 2.4, -2.5, 0, -Math.PI / 2);
  kit.plane(WALL, 14, 4.8, 0, 2.4, 4.4, 0);
  // Split far wall so the archway reads as a door, not a second room.
  kit.box(WALL, 4.6, 4.8, 0.35, -5.0, 2.4, -9.35);
  kit.box(WALL, 4.6, 4.8, 0.35, 5.0, 2.4, -9.35);
  kit.box(WALL, 14, 1.5, 0.35, 0, 4.05, -9.35);
  kit.box(DARK, 3.4, 3.2, 0.12, 0, 1.6, -9.5);

  kit.arch(EMERALD, 0, -4.4, 3.8, 3.15, 0.46);
  kit.box(GOLD, 0.24, 3.5, 0.24, -5.2, 1.75, -1.8);
  kit.box(GOLD, 0.24, 3.5, 0.24, 5.2, 1.75, -1.8);
  kit.box(GOLD, 0.24, 3.5, 0.24, -5.2, 1.75, -6.8);
  kit.box(GOLD, 0.24, 3.5, 0.24, 5.2, 1.75, -6.8);
  kit.box(CREAM, 0.7, 0.1, 0.7, 0, 4.52, -4.4, undefined, 0.95);

  kit.box(WOOD, 2.2, 0.9, 0.85, -4.8, 0.45, -1.6);
  kit.box(AMBER, 0.5, 0.14, 0.5, -4.8, 0.98, -1.6, undefined, 1.0);
  kit.box(EMERALD, 8.4, 0.14, 0.22, 0, 3.55, -8.9);
  kit.box(WALL, 2.8, 0.45, 0.2, 0, 3.15, -9.22);
  kit.box(GOLD, 0.24, 3.1, 0.24, -1.45, 1.55, -9.18);
  kit.box(GOLD, 0.24, 3.1, 0.24, 1.45, 1.55, -9.18);
  kit.box(EMERALD, 0.26, 0.26, 0.12, 1.2, 2.4, -9.1, undefined, 1.1);
}

function buildStair(kit: SimstimKit): void {
  kit.beginZone('stair');
  kit.plane(FLOOR, 10, 14, 0, 0, -15.5, -Math.PI / 2);
  kit.plane(CEIL, 10, 14, 0, 5.4, -15.5, Math.PI / 2);
  kit.plane(WALL, 14, 5.4, -5, 2.7, -15.5, 0, Math.PI / 2);
  kit.plane(WALL, 14, 5.4, 5, 2.7, -15.5, 0, -Math.PI / 2);
  kit.plane(WALL, 10, 5.4, 0, 2.7, -22.4, 0);

  kit.stairs(CREAM, 1.55, -10.6, 8, 1.7, 0.28, 0.52);
  kit.box(GOLD, 0.1, 2.4, 4.2, 0.62, 1.2, -12.4);
  kit.box(GOLD, 0.1, 2.4, 4.2, 2.48, 1.2, -12.4);
  kit.box(EMERALD, 1.9, 0.12, 0.7, 1.55, 2.3, -14.3);
  kit.box(WOOD, 1.9, 0.18, 1.1, 1.55, 2.38, -14.85);
  kit.arch(EMERALD, 0, -17.6, 3.2, 2.9, 0.36);
  kit.box(GOLD, 0.16, 2.8, 0.16, -2.2, 1.4, -17.6);
  kit.box(GOLD, 0.16, 2.8, 0.16, 2.2, 1.4, -17.6);

  kit.mannequin('hideo', -1.7, 0, -17.4, 0.4, 'hideo');
}

function buildGallery(kit: SimstimKit): void {
  kit.beginZone('gallery');
  kit.plane(FLOOR, 11, 12, 0, 0, -25.5, -Math.PI / 2);
  kit.plane(CEIL, 11, 12, 0, 4.2, -25.5, Math.PI / 2);
  kit.plane(COOL, 12, 4.2, -5.5, 2.1, -25.5, 0, Math.PI / 2);
  kit.plane(COOL, 12, 4.2, 5.5, 2.1, -25.5, 0, -Math.PI / 2);
  kit.plane(WALL, 11, 4.2, 0, 2.1, -31.4, 0);
  kit.plane(WALL, 11, 4.2, 0, 2.1, -19.6, 0);

  kit.arch(EMERALD, 0, -22.2, 3.4, 2.95, 0.38);
  kit.arch(EMERALD, 0, -28.6, 3.4, 2.95, 0.38);

  // Riviera holograms: thin emissive slabs, not a lightshow.
  kit.box(PEARL, 0.08, 1.8, 0.7, -4.6, 1.4, -23.4, undefined, 1.05);
  kit.box(AMBER, 0.08, 1.5, 0.55, -4.6, 1.25, -25.8, undefined, 1.1);
  kit.box(PEARL, 0.08, 1.7, 0.6, 4.6, 1.35, -24.2, undefined, 1.05);
  kit.box(CREAM, 0.08, 1.4, 0.5, 4.6, 1.2, -27.0, undefined, 1.0);
  kit.box(DARK, 0.12, 2.0, 0.9, -4.72, 1.4, -23.4);
  kit.box(DARK, 0.12, 1.7, 0.75, 4.72, 1.35, -24.2);

  kit.box(GOLD, 0.2, 3.4, 0.2, -2.4, 1.7, -31.15);
  kit.box(GOLD, 0.2, 3.4, 0.2, 2.4, 1.7, -31.15);
  kit.box(DARK, 2.4, 2.8, 0.14, 0, 1.4, -31.22);
  kit.box(EMERALD, 0.2, 0.2, 0.1, 0.95, 2.3, -31.1, undefined, 1.05);

  kit.mannequin('riviera', 1.85, 0, -24.6, -0.6, 'riviera');
  kit.mannequin('jane', 1.2, 0, -30.4, Math.PI, 'jane');
}

function buildHead(kit: SimstimKit): void {
  kit.beginZone('head');
  kit.plane(FLOOR, 8.4, 10, 0, 0, -35.4, -Math.PI / 2);
  kit.plane(CEIL, 8.4, 10, 0, 3.8, -35.4, Math.PI / 2);
  kit.plane(WALL, 8.4, 3.8, 0, 1.9, -40.3, 0);
  kit.plane(WALL, 10, 3.8, -4.2, 1.9, -35.4, 0, Math.PI / 2);
  kit.plane(WALL, 10, 3.8, 4.2, 1.9, -35.4, 0, -Math.PI / 2);
  kit.plane(WALL, 8.4, 3.8, 0, 1.9, -30.5, 0);

  kit.box(GOLD, 0.28, 3.4, 0.28, -3.2, 1.7, -31.0);
  kit.box(GOLD, 0.28, 3.4, 0.28, 3.2, 1.7, -31.0);
  kit.box(GOLD, 0.28, 3.4, 0.28, -3.2, 1.7, -39.6);
  kit.box(GOLD, 0.28, 3.4, 0.28, 3.2, 1.7, -39.6);
  kit.box(LAPIS, 7.2, 0.55, 0.18, 0, 0.28, -40.1);
  kit.box(EMERALD, 6.4, 0.12, 0.16, 0, 3.15, -39.9);
  kit.box(WOOD, 1.4, 0.5, 1.4, 0, 0.25, -35.5);
  const head = kit.cameo('cameo', 0, 0.5, -35.5);
  head.scale.set(1.85, 1.85, 1.85);
}
