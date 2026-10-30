import { generateLandmark, getLandmark, landmarkWorldPos } from '../content/landmarks';
import type { LandmarkId } from '../content/landmarks';
import { sphereHull, type CollisionWorld } from '../player/Collision';
import { createGroundGrid, type GroundGrid } from '../render/grid/GroundGrid';
import { createLocalLattice, type LocalLattice } from '../render/grid/LocalLattice';
import { createBeamBatch, lineSetCount, type BeamBatchGpu } from '../render/lines/BeamBatch';
import { createPointBatch, type GpuPointBatch } from '../render/points/PointBatch';
import type { Renderer } from '../render/Renderer';
import { M4_DROP } from '../content/missions/m4';

const SCENE_IDS: readonly LandmarkId[] = [M4_DROP];
const LANDMARK_SCALE = 6;

export interface PlacedLandmark {
  id: LandmarkId;
  x: number;
  y: number;
  z: number;
}

export interface TuringScene {
  readonly grid: GroundGrid;
  readonly lattice: LocalLattice;
  readonly landmarks: readonly PlacedLandmark[];
  follow(cam: { x: number; y: number; z: number }, latticeRadius: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

/** Turing Registry geodesic on the 1984 vector grid — MIL, not neon. */
export function createTuringScene(renderer: Renderer, collision: CollisionWorld): TuringScene {
  const grid = createGroundGrid(renderer.palette);
  const lattice = createLocalLattice(renderer.palette, {
    radius: renderer.quality.latticeRadius,
  });
  renderer.scenes.matrix.add(grid.object);
  renderer.scenes.matrix.add(lattice.object);

  const batches: Array<BeamBatchGpu | GpuPointBatch> = [];
  const landmarks: PlacedLandmark[] = [];

  for (const id of SCENE_IDS) {
    const def = getLandmark(id);
    if (!def) continue;
    const pos = landmarkWorldPos(def.coords);
    const geom = generateLandmark(id, { lod: 'near', seed: 4 });
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

  return {
    grid,
    lattice,
    landmarks,
    follow(cam, latticeRadius) {
      grid.follow(cam);
      lattice.radius = latticeRadius;
      lattice.update(cam);
    },
    setVisible(on) {
      grid.object.visible = on;
      lattice.visible = on;
      for (const b of batches) b.object.visible = on;
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
      for (const lm of landmarks) collision.remove(`lm-${lm.id}`);
    },
  };
}
