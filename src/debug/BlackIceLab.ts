/**
 * Dev route `?lab=blackice` (M1.8). A hot construct behind a black ICE shard
 * so the solid eats glow, UV edges crawl, and `?scene=grip` grows screen-edge
 * tendrils. Query: `?lab=blackice&quality=high&scene=shard|grip`.
 */

import { BoxGeometry, Color, Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three';
import { createBlackIceSolid, octahedronLineSet } from '../render/faces/blackIce';
import { asBlackIceComposite } from '../render/post/BlackIceComposite';
import { createUvEdgeMaterial, setUvEdgeTime } from '../render/faces/uvEdge';
import { Beam, createBeamBatch } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { Renderer } from '../render/Renderer';

export const BLACK_ICE_SCENES = ['shard', 'grip'] as const;
export type BlackIceScene = (typeof BLACK_ICE_SCENES)[number];

export function isBlackIceScene(value: string | null): value is BlackIceScene {
  return (BLACK_ICE_SCENES as readonly string[]).includes(value ?? '');
}

export interface BlackIceLab {
  update(dt: number): void;
  dispose(): void;
  readonly scene: BlackIceScene;
  setScene(scene: BlackIceScene): void;
  setGrip(grip: number): void;
}

export interface BlackIceLabHandle {
  scene: BlackIceScene;
  grip: number;
  strength: number;
  setScene(scene: BlackIceScene): void;
  setGrip(grip: number): void;
}

declare global {
  interface Window {
    __nonspaceBlackIce?: BlackIceLabHandle;
  }
}

export interface BlackIceLabOptions {
  scene?: string;
  grip?: string;
}

export function installBlackIceLab(
  renderer: Renderer,
  root: HTMLElement,
  opts: BlackIceLabOptions = {},
): BlackIceLab {
  const pass = asBlackIceComposite(renderer.chain.getPass('blackIce'));
  const sceneArg = opts.scene ?? null;
  const startScene: BlackIceScene = isBlackIceScene(sceneArg)
    ? sceneArg
    : opts.grip === '1' || opts.grip === 'true'
      ? 'grip'
      : 'shard';

  const wall = makeWall();
  renderer.scenes.matrix.add(wall);

  const solid = createBlackIceSolid(1);
  solid.mesh.position.set(0, 0, 0.15);
  solid.mesh.scale.set(0.78, 1.45, 0.55);
  solid.mesh.rotation.set(0.12, 0.28, 0.05);
  renderer.scenes.blackIce.add(solid.mesh);

  const uvMat = createUvEdgeMaterial();
  const edges = createBeamBatch(renderer.palette, { material: uvMat, capacity: 16 });
  edges.setStatic(octahedronLineSet());
  edges.object.position.copy(solid.mesh.position);
  edges.object.scale.copy(solid.mesh.scale);
  edges.object.rotation.copy(solid.mesh.rotation);
  renderer.scenes.matrix.add(edges.object);

  renderer.cameras.matrix.position.set(0, 0.05, 2.45);
  renderer.cameras.matrix.lookAt(0, 0, 0);

  const hud = document.createElement('div');
  hud.dataset.testid = 'black-ice-lab';
  hud.style.cssText = [
    'position:absolute',
    'left:12px',
    'top:12px',
    'z-index:5',
    'pointer-events:none',
    'font:12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    'color:#c8b4ff',
    'text-shadow:0 0 8px #000',
  ].join(';');
  root.appendChild(hud);

  let scene: BlackIceScene = startScene;
  let t = 0;

  const applyScene = (next: BlackIceScene): void => {
    scene = next;
    pass.grip = next === 'grip' ? 1 : 0;
  };
  applyScene(startScene);

  const syncHud = (): void => {
    hud.textContent = `BLACK ICE  ${scene.toUpperCase()}  grip=${pass.grip.toFixed(2)}`;
    root.dataset.lab = 'blackice';
    root.dataset.scene = scene;
    root.dataset.grip = pass.grip > 0.5 ? '1' : '0';
  };
  syncHud();

  const handle: BlackIceLabHandle = {
    get scene() {
      return scene;
    },
    get grip() {
      return pass.grip;
    },
    get strength() {
      return pass.strength;
    },
    setScene(next) {
      applyScene(next);
      syncHud();
    },
    setGrip(grip) {
      pass.grip = Math.min(1, Math.max(0, grip));
      scene = pass.grip > 0.5 ? 'grip' : 'shard';
      syncHud();
    },
  };
  window.__nonspaceBlackIce = handle;

  return {
    get scene() {
      return scene;
    },
    setScene(next) {
      handle.setScene(next);
    },
    setGrip(grip) {
      handle.setGrip(grip);
    },
    update(dt) {
      t += dt;
      setUvEdgeTime(uvMat, t);
      solid.mesh.rotation.y = 0.42 + t * 0.12;
      edges.object.rotation.y = solid.mesh.rotation.y;
      syncHud();
    },
    dispose() {
      hud.remove();
      delete root.dataset.lab;
      delete root.dataset.scene;
      delete root.dataset.grip;
      if (window.__nonspaceBlackIce === handle) delete window.__nonspaceBlackIce;
      renderer.scenes.matrix.remove(wall);
      renderer.scenes.matrix.remove(edges.object);
      renderer.scenes.blackIce.remove(solid.mesh);
      disposeObject(wall);
      edges.dispose();
      uvMat.dispose();
      solid.dispose();
      pass.grip = 0;
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

function makeWall(): Mesh {
  const geom = new BoxGeometry(5.6, 3.4, 0.35);
  const mat = new MeshBasicMaterial({
    color: beamColor(Beam.AMBER, 4),
    toneMapped: false,
  });
  const mesh = new Mesh(geom, mat);
  mesh.position.set(0, 0, -1.05);
  mesh.frustumCulled = false;
  mesh.name = 'blackIceConstruct';
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
