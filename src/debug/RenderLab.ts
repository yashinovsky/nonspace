import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { Beam } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { Renderer } from '../render/Renderer';

export interface RenderLab {
  update(dt: number): void;
  dispose(): void;
}

/**
 * `?lab=render` — two unlit cubes in the matrix scene. The left one is HDR
 * (intensity 4) so FinalComposite's Reinhard + desaturate-to-white pulls it
 * toward white; the right one stays nominal amber. Proves the M0.4 AC:
 * scene → 16F target → tonemap → screen.
 */
export function installRenderLab(renderer: Renderer): RenderLab {
  const hot = makeCube(4, -0.7);
  const cool = makeCube(0.55, 0.85);
  const group: Object3D[] = [hot, cool];
  for (const obj of group) renderer.scenes.matrix.add(obj);

  let t = 0;
  return {
    update(dt) {
      t += dt;
      hot.rotation.y = t * 0.7;
      hot.rotation.x = Math.sin(t * 0.35) * 0.35;
      cool.rotation.y = t * 0.45 + 0.6;
      cool.rotation.x = Math.cos(t * 0.3) * 0.25;
    },
    dispose() {
      for (const obj of group) {
        renderer.scenes.matrix.remove(obj);
        disposeObject(obj);
      }
    },
  };
}

function makeCube(intensity: number, x: number): Mesh {
  const geom = new BoxGeometry(0.9, 0.9, 0.9);
  const hex = BEAM_HEX[Beam.AMBER]!;
  const color = new Color().setRGB(
    (((hex >> 16) & 255) / 255) * intensity,
    (((hex >> 8) & 255) / 255) * intensity,
    ((hex & 255) / 255) * intensity,
  );
  const mat = new MeshBasicMaterial({ color, toneMapped: false });
  const mesh = new Mesh(geom, mat);
  mesh.position.set(x, 0, 0);
  mesh.frustumCulled = false;

  const edgeHex = BEAM_HEX[Beam.GRID]!;
  const edges = new LineSegments(
    new EdgesGeometry(geom),
    new LineBasicMaterial({
      color: new Color().setRGB(
        (((edgeHex >> 16) & 255) / 255) * Math.min(intensity, 1.2),
        (((edgeHex >> 8) & 255) / 255) * Math.min(intensity, 1.2),
        ((edgeHex & 255) / 255) * Math.min(intensity, 1.2),
      ),
      toneMapped: false,
    }),
  );
  mesh.add(edges);
  return mesh;
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}
