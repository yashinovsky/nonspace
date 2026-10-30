import { Group, type Object3D } from 'three';
import { createCoreInterior, type CoreInterior } from '../breach/CoreInterior';
import { generateLandmark, getLandmark, landmarkWorldPos } from '../content/landmarks';
import type { LandmarkId } from '../content/landmarks';
import { M5_CLUSTER, M5_RECORD } from '../content/missions/m5';
import { sphereHull, type CollisionWorld } from '../player/Collision';
import { createGroundGrid, type GroundGrid } from '../render/grid/GroundGrid';
import { createLocalLattice, type LocalLattice } from '../render/grid/LocalLattice';
import { createBeamBatch, lineSetCount, type BeamBatchGpu } from '../render/lines/BeamBatch';
import { createPointBatch, type GpuPointBatch } from '../render/points/PointBatch';
import type { Renderer } from '../render/Renderer';

const SCENE_IDS: readonly LandmarkId[] = [M5_CLUSTER];
/** Emerald terrace reads aristocratic at this scale (heraldry #22). */
const LANDMARK_SCALE = 8;
/** Straylight core is colossal versus the terrace (core #41). */
const CORE_SCALE = 22;

export interface PlacedLandmark {
  id: LandmarkId;
  x: number;
  y: number;
  z: number;
}

export interface KuangScene {
  readonly grid: GroundGrid;
  readonly lattice: LocalLattice;
  readonly landmarks: readonly PlacedLandmark[];
  readonly core: CoreInterior;
  follow(cam: { x: number; y: number; z: number }, latticeRadius: number): void;
  setVisible(on: boolean): void;
  paint(): void;
  dispose(): void;
}

/**
 * Tessier-Ashpool cluster: emerald slab terraces plus a colossal core
 * cathedral hanging in the orbital tier. 1984 vector CRT, not neon.
 */
export function createKuangScene(renderer: Renderer, collision: CollisionWorld): KuangScene {
  const grid = createGroundGrid(renderer.palette);
  const lattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);

  const batches: Array<BeamBatchGpu | GpuPointBatch> = [];
  const landmarks: PlacedLandmark[] = [];
  const extras: Object3D[] = [];

  for (const id of SCENE_IDS) {
    const def = getLandmark(id);
    if (!def) continue;
    const pos = landmarkWorldPos(def.coords);
    const geom = generateLandmark(id, { lod: 'near', seed: 11 });
    const nLines = lineSetCount(geom.lines);
    if (nLines > 0) {
      const lines = createBeamBatch(renderer.palette, { capacity: Math.max(nLines, 8) });
      lines.setStatic(geom.lines);
      lines.object.position.set(pos.x, pos.y, pos.z);
      lines.object.scale.setScalar(LANDMARK_SCALE);
      lines.object.name = `landmark:${id}`;
      renderer.scenes.matrix.add(lines.object);
      batches.push(lines);
    }
    const nPts = geom.points.color.length;
    if (nPts > 0) {
      const pts = createPointBatch({
        capacity: Math.max(nPts, 8),
        palette: renderer.palette,
      });
      pts.setStatic(geom.points);
      pts.object.position.set(pos.x, pos.y, pos.z);
      pts.object.scale.setScalar(LANDMARK_SCALE);
      pts.object.name = `landmarkPts:${id}`;
      renderer.scenes.matrix.add(pts.object);
      batches.push(pts);
    }
    collision.add(
      sphereHull(`lm-${id}`, 'construct', pos.x, pos.y, pos.z, 18 * LANDMARK_SCALE * 0.15),
    );
    landmarks.push({ id, x: pos.x, y: pos.y, z: pos.z });
  }

  const cluster = landmarks[0] ?? { id: M5_CLUSTER, x: 0, y: 5600, z: 0 };
  const core = createCoreInterior({
    def: { seed: 11, strata: 12, targetRecord: M5_RECORD, layers: 1, downloadHold: 3 },
  });
  const before = new Set(renderer.scenes.matrix.children);
  core.attach(renderer);
  const coreGroup = new Group();
  coreGroup.name = 'straylight-core';
  coreGroup.position.set(cluster.x, cluster.y + 80, cluster.z - 40);
  coreGroup.scale.setScalar(CORE_SCALE);
  for (const child of [...renderer.scenes.matrix.children]) {
    if (before.has(child)) continue;
    renderer.scenes.matrix.remove(child);
    coreGroup.add(child);
  }
  renderer.scenes.matrix.add(coreGroup);
  extras.push(coreGroup);

  return {
    grid,
    lattice,
    landmarks,
    core,
    follow(cam, latticeRadius) {
      grid.follow(cam);
      lattice.radius = latticeRadius;
      lattice.update(cam);
    },
    setVisible(on) {
      grid.object.visible = on;
      lattice.visible = on;
      for (const b of batches) b.object.visible = on;
      for (const e of extras) e.visible = on;
    },
    paint() {
      core.paint();
    },
    dispose() {
      renderer.scenes.matrix.remove(grid.object);
      renderer.scenes.matrix.remove(lattice.object);
      grid.dispose();
      lattice.dispose();
      for (const b of batches) {
        renderer.scenes.matrix.remove(b.object);
        b.dispose();
      }
      core.dispose();
      for (const e of extras) renderer.scenes.matrix.remove(e);
      for (const lm of landmarks) collision.remove(`lm-${lm.id}`);
    },
  };
}
