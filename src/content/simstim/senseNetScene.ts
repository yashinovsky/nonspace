/**
 * Procedural Sense/Net interiors (M6.2). Flat boxes and arches, I, Robot /
 * broadcast-ident 1984 — not a later-cyberpunk tower. One connected walk:
 * lobby → corridor → vault, each zone ≤ ~3k tris.
 */
import type { SimstimKit } from '../../render/simstim/kit';

const FLOOR = 0xb0aaa2;
const CEIL = 0x7a7680;
const WALL = 0xa0b8c0;
const WALL_IN = 0xa0b8c0;
const TRIM = 0x6e6a74;
const WOOD = 0xb88858;
const WARM = 0xe8b888;
const AMBER = 0xe8a010;
const DARK = 0x2a2830;
const DOOR = 0x1c1a22;
const RED = 0xc03028;
const COOL = 0x5a7a8c;
const CROWD = 0x4a4854;

/** M6.1 placeholder lobby, kept for `?lab=simstim&scene=lab`. */
export function buildLabLobby(kit: SimstimKit): void {
  kit.beginZone('lobby');
  kit.plane(0x7a7680, 24, 16, 0, 0, -4, -Math.PI / 2);
  kit.plane(0x4a4854, 24, 16, 0, 4.2, -4, Math.PI / 2);
  kit.plane(0xa0b8c0, 24, 4.2, 0, 2.1, -12, 0);
  kit.plane(0xa0b8c0, 16, 4.2, -12, 2.1, -4, 0, Math.PI / 2);
  kit.plane(0xa0b8c0, 16, 4.2, 12, 2.1, -4, 0, -Math.PI / 2);
  kit.box(0xb88858, 1.2, 1.4, 1.2, -3.4, 0.7, -5.5);
  kit.box(0xe8b888, 0.8, 0.4, 1.6, 3.2, 0.2, -4.2);
  kit.box(0x6e6a74, 0.3, 3.6, 0.3, -1.6, 1.8, -9.4);
  kit.box(0x6e6a74, 0.3, 3.6, 0.3, 1.6, 1.8, -9.4);
  kit.box(0x1c1a22, 2.2, 3.2, 0.12, 0, 1.6, -9.5);
  kit.box(0xc03028, 0.35, 0.35, 0.12, 0.85, 2.2, -9.4);
  kit.mannequin('guard', 2.1, 0, -6.2, Math.PI);
}

export function buildSenseNet(kit: SimstimKit): void {
  buildLobby(kit);
  buildCorridor(kit);
  buildVault(kit);
}

export function buildSimstimScene(scene: string, kit: SimstimKit): void {
  if (scene === 'lab:lobby' || scene === 'lab') {
    buildLabLobby(kit);
    return;
  }
  buildSenseNet(kit);
}

function buildLobby(kit: SimstimKit): void {
  kit.beginZone('lobby');
  kit.plane(FLOOR, 18, 16, 0, 0, -2, -Math.PI / 2);
  kit.plane(CEIL, 18, 16, 0, 5.1, -2, Math.PI / 2);
  kit.plane(WALL, 18, 5.1, 0, 2.55, -10, 0);
  kit.plane(WALL, 16, 5.1, -9, 2.55, -2, 0, Math.PI / 2);
  kit.plane(WALL, 16, 5.1, 9, 2.55, -2, 0, -Math.PI / 2);
  kit.plane(WALL_IN, 18, 5.1, 0, 2.55, 6, 0);

  kit.box(TRIM, 0.35, 5.0, 0.35, -4.2, 2.5, -9.7);
  kit.box(TRIM, 0.35, 5.0, 0.35, 4.2, 2.5, -9.7);
  kit.box(TRIM, 0.35, 5.0, 0.35, -8.6, 2.5, -2);
  kit.box(TRIM, 0.35, 5.0, 0.35, 8.6, 2.5, -2);

  kit.box(WOOD, 2.6, 1.15, 1.1, -4.4, 0.58, -3.6);
  kit.box(WARM, 0.7, 0.08, 0.7, -4.4, 1.2, -3.6);
  kit.box(DARK, 0.5, 0.7, 0.08, -3.4, 1.55, -3.15);

  kit.box(FLOOR, 1.4, 0.38, 0.7, 4.6, 0.19, -1.8);
  kit.box(FLOOR, 1.4, 0.38, 0.7, 6.2, 0.19, -4.4);
  kit.box(0x4a6a48, 0.7, 0.55, 0.7, 6.8, 0.28, -1.2);

  kit.box(WALL_IN, 10, 0.18, 1.4, 0, 3.35, -8.6);
  kit.box(TRIM, 10, 0.08, 0.12, 0, 3.52, -7.95);

  identWall(kit, 0, 2.4, -9.85);

  kit.box(TRIM, 0.22, 3.4, 0.22, -1.35, 1.7, -9.55);
  kit.box(TRIM, 0.22, 3.4, 0.22, 1.35, 1.7, -9.55);
  kit.box(DOOR, 0.55, 3.1, 0.14, -0.95, 1.55, -9.62);
  kit.box(DOOR, 0.55, 3.1, 0.14, 0.95, 1.55, -9.62);
  kit.box(DOOR, 2.4, 0.4, 0.14, 0, 3.05, -9.62);
  kit.box(AMBER, 0.28, 0.28, 0.12, 1.12, 2.55, -9.5);

  kit.box(WALL, 3.2, 5.0, 0.4, -5.4, 2.5, -9.8);
  kit.box(WALL, 3.2, 5.0, 0.4, 5.4, 2.5, -9.8);

  kit.mannequin('guard-lobby', 2.4, 0, -7.2, Math.PI);
  kit.mannequin('guard-desk', -3.6, 0, -4.2, 0.4);

  kit.crowd('crowd-0', CROWD, -2.2, 0, -3.4);
  kit.crowd('crowd-1', CROWD, 1.6, 0, -4.8);
  kit.crowd('crowd-2', CROWD, -0.4, 0, -8.2);
  kit.crowd('crowd-6', COOL, -2.4, 0, -5.8);
}

function identWall(kit: SimstimKit, x: number, y: number, z: number): void {
  kit.box(DARK, 3.6, 2.2, 0.16, x, y, z);
  kit.box(AMBER, 0.22, 1.6, 0.12, x, y + 0.1, z + 0.12);
  kit.box(AMBER, 0.7, 0.18, 0.12, x, y + 0.85, z + 0.12);
  kit.box(AMBER, 0.55, 0.55, 0.1, x, y - 0.15, z + 0.14);
  kit.box(AMBER, 0.28, 0.28, 0.1, x + 0.85, y + 0.55, z + 0.14);
  kit.box(AMBER, 0.28, 0.28, 0.1, x - 0.85, y + 0.55, z + 0.14);
}

function buildCorridor(kit: SimstimKit): void {
  kit.beginZone('corridor');
  kit.plane(FLOOR, 5.2, 18, 0, 0, -19, -Math.PI / 2);
  kit.plane(CEIL, 5.2, 18, 0, 3.4, -19, Math.PI / 2);
  kit.plane(WALL_IN, 18, 3.4, -2.6, 1.7, -19, 0, Math.PI / 2);
  kit.plane(WALL_IN, 18, 3.4, 2.6, 1.7, -19, 0, -Math.PI / 2);

  for (let i = 0; i < 5; i++) {
    const z = -12.2 - i * 3.2;
    kit.arch(TRIM, 0, z, 3.4, 2.85, 0.38);
    kit.box(WARM, 0.55, 0.08, 0.55, 0, 3.22, z);
    if (i === 1 || i === 3) {
      kit.box(DARK, 0.08, 2.1, 1.1, -2.52, 1.2, z - 0.6);
      kit.box(DARK, 0.08, 2.1, 1.1, 2.52, 1.2, z - 0.6);
    }
  }

  kit.box(TRIM, 0.2, 2.8, 0.2, -1.2, 1.4, -18.95);
  kit.box(TRIM, 0.2, 2.8, 0.2, 1.2, 1.4, -18.95);
  kit.box(DOOR, 2.2, 2.6, 0.16, 0, 1.3, -19.02);
  kit.box(AMBER, 0.24, 0.24, 0.1, 0.85, 2.2, -18.9);
  kit.box(RED, 0.18, 0.18, 0.1, -0.85, 2.2, -18.9);

  kit.alarm(RED, -2.42, 2.85, -13.4);
  kit.alarm(RED, 2.42, 2.85, -16.6);
  kit.alarm(RED, -2.42, 2.85, -22.8);
  kit.alarm(RED, 2.42, 2.85, -25.4);

  kit.mannequin('guard-corridor', 1.55, 0, -18.6, Math.PI);

  kit.crowd('crowd-3', CROWD, 2.0, 0, -12.4);
  kit.crowd('crowd-4', CROWD, -1.8, 0, -14.6);
  kit.crowd('crowd-5', COOL, 0.6, 0, -16.8);
  kit.crowd('crowd-7', CROWD, 1.1, 0, -9.6);
}

function buildVault(kit: SimstimKit): void {
  kit.beginZone('vault');
  kit.plane(FLOOR, 8.4, 12, 0, 0, -33, -Math.PI / 2);
  kit.plane(CEIL, 8.4, 12, 0, 3.6, -33, Math.PI / 2);
  kit.plane(COOL, 8.4, 3.6, 0, 1.8, -39, 0);
  kit.plane(COOL, 12, 3.6, -4.2, 1.8, -33, 0, Math.PI / 2);
  kit.plane(COOL, 12, 3.6, 4.2, 1.8, -33, 0, -Math.PI / 2);
  kit.plane(WALL, 8.4, 3.6, 0, 1.8, -27, 0);

  kit.box(TRIM, 0.45, 3.4, 0.45, -3.4, 1.7, -27.2);
  kit.box(TRIM, 0.45, 3.4, 0.45, 3.4, 1.7, -27.2);
  kit.box(DOOR, 2.6, 2.9, 0.22, 0, 1.45, -27.05);
  kit.box(AMBER, 0.22, 0.22, 0.12, 1.05, 2.35, -26.9);
  kit.box(DARK, 0.7, 0.5, 0.08, 0, 2.0, -26.92);

  kit.box(TRIM, 0.4, 3.2, 0.4, -3.6, 1.6, -38.4);
  kit.box(TRIM, 0.4, 3.2, 0.4, 3.6, 1.6, -38.4);
  kit.box(TRIM, 0.4, 3.2, 0.4, -3.6, 1.6, -29.6);
  kit.box(TRIM, 0.4, 3.2, 0.4, 3.6, 1.6, -29.6);

  kit.box(WOOD, 1.3, 0.85, 1.3, 0, 0.42, -36.2);
  kit.box(AMBER, 0.55, 0.7, 0.4, 0, 1.2, -36.2);
  kit.box(WARM, 0.62, 0.08, 0.46, 0, 1.58, -36.2);

  kit.box(DARK, 1.8, 1.6, 0.2, -2.8, 1.4, -38.7);
  kit.box(DARK, 1.8, 1.6, 0.2, 2.8, 1.4, -38.7);

  kit.alarm(RED, 0, 3.25, -38.6);
  kit.alarm(RED, -3.9, 2.9, -33);

  kit.mannequin('guard-vault', -1.7, 0, -29.4, 0.2);
}
