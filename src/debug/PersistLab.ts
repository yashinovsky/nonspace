import { BoxGeometry, Color, Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three';
import { Beam } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { PersistencePass } from '../render/post/PersistencePass';
import type { Renderer } from '../render/Renderer';

export interface PersistLab {
  update(dt: number): void;
  dispose(): void;
}

/**
 * `?lab=persist` — a GRID radar arm and orbiting lightpoints so M1.4 P7
 * trails are visible: live beam stays blue-white, decay shifts yellow-green.
 * Pair with `?quality=medium` or `high` (SwiftShader `auto` is Low and skips).
 */
export function installPersistLab(renderer: Renderer): PersistLab {
  const arm = makeBar(2.4, 0.045, Beam.GRID, 2.4);
  const orbitA = makeBar(0.22, 0.22, Beam.GRID, 3.2);
  const orbitB = makeBar(0.16, 0.16, Beam.ICE, 2.2);
  const group: Object3D[] = [arm, orbitA, orbitB];
  for (const obj of group) renderer.scenes.matrix.add(obj);

  const root = renderer.canvas.parentElement;
  const hud = document.createElement('div');
  hud.dataset.testid = 'persist-lab';
  hud.style.cssText = [
    'position:absolute',
    'left:12px',
    'bottom:12px',
    'pointer-events:none',
    'font:12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    'color:#c6f03a',
    'text-shadow:0 0 8px #000',
    'z-index:5',
  ].join(';');
  hud.textContent = 'PHOSPHOR  P7';
  root?.appendChild(hud);

  const persist = renderer.chain.getPass('persistence') as PersistencePass;
  renderer.cameras.matrix.position.set(0, 1.8, 3.4);
  renderer.cameras.matrix.lookAt(0, 0, 0);

  let t = 0;
  return {
    update(dt) {
      t += dt;
      arm.rotation.y = t * 1.35;
      const a = t * 2.1;
      orbitA.position.set(Math.cos(a) * 1.35, 0.15 + Math.sin(a * 0.5) * 0.2, Math.sin(a) * 1.35);
      const b = t * -1.55 + 1.2;
      orbitB.position.set(Math.cos(b) * 0.95, 0.45, Math.sin(b) * 0.95);
      if (root) {
        root.dataset.persistOn = renderer.quality.persistence ? '1' : '0';
        root.dataset.decayScale = String(persist.decayScale);
      }
    },
    dispose() {
      hud.remove();
      if (root) {
        delete root.dataset.persistOn;
        delete root.dataset.decayScale;
      }
      for (const obj of group) {
        renderer.scenes.matrix.remove(obj);
        disposeObject(obj);
      }
    },
  };
}

function beamColor(index: Beam, intensity: number): Color {
  const hex = BEAM_HEX[index]!;
  return new Color().setRGB(
    (((hex >> 16) & 255) / 255) * intensity,
    (((hex >> 8) & 255) / 255) * intensity,
    ((hex & 255) / 255) * intensity,
  );
}

function makeBar(length: number, thickness: number, hue: Beam, intensity: number): Mesh {
  const geom = new BoxGeometry(thickness, thickness, length);
  const mat = new MeshBasicMaterial({ color: beamColor(hue, intensity), toneMapped: false });
  const mesh = new Mesh(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}
