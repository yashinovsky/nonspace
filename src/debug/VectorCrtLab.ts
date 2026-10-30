import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  type Object3D,
} from 'three';
import { Beam, createBeamBatch } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import { asVectorCrtPass, type VectorCrtPass } from '../render/post/VectorCrtPass';
import {
  HERSHEY_SCREEN_FLAGS,
  hersheyCapWorldForPixels,
  layoutHershey,
  loadHersheyFont,
} from '../render/text/HersheyText';

export interface VectorCrtLab {
  update(dt: number): void;
  dispose(): void;
  readonly pass: VectorCrtPass;
}

const SCREEN_DIST = 2.4;
const HERSHEY_CAP_PX = 16;

/**
 * `?lab=vector` — calligraphic vector CRT (M1.6). A filled lattice plus
 * Hershey simplex `NONSPACE` (world + 16 px screen) so barrel / vignette /
 * glass / grain are visible and M3.1 text stays readable at 1080p.
 * Lazy-imported from App. Font fetch gunzips only when gzip magic remains.
 */
export async function installVectorCrtLab(renderer: Renderer): Promise<VectorCrtLab> {
  const pass = asVectorCrtPass(renderer.chain.vectorCrt);
  renderer.vectorLoad = 0.85;
  renderer.cameras.matrix.position.set(0, 0, 4);
  renderer.cameras.matrix.lookAt(0, 0, 0);
  renderer.cameras.matrix.updateMatrixWorld();

  const font = await loadHersheyFont('/fonts/hershey/simplex.bin.gz');

  const grid = makeGrid(16, 24, beamColor(Beam.GRID, 0.85));
  const frame = makeRect(10, 6.4, beamColor(Beam.ICE, 1.1));
  const group: Object3D[] = [grid, frame];
  for (const obj of group) renderer.scenes.matrix.add(obj);

  const title = createBeamBatch(renderer.palette, { capacity: 256 });
  title.setStatic(
    layoutHershey(font, 'NONSPACE', {
      capHeight: 0.42,
      color: Beam.AMBER,
      intensity: 1.8,
      width: 1.6,
      align: 'center',
      y: 0.12,
    }),
  );
  renderer.scenes.matrix.add(title.object);

  const screen = createBeamBatch(renderer.palette, { capacity: 256 });
  const layoutScreen = (): number => {
    const cap = hersheyCapWorldForPixels(
      HERSHEY_CAP_PX,
      SCREEN_DIST,
      renderer.cameras.matrix.fov,
      renderer.cssHeight,
    );
    screen.setStatic(
      layoutHershey(font, 'NONSPACE', {
        capHeight: cap,
        color: Beam.GRID,
        intensity: 1.55,
        width: 1.35,
        flags: HERSHEY_SCREEN_FLAGS,
        align: 'center',
      }),
    );
    return cap;
  };
  layoutScreen();
  renderer.scenes.matrix.add(screen.object);
  const screenLocal = new Matrix4();
  screenLocal.makeTranslation(0, -0.62, -SCREEN_DIST);
  screen.transform.multiplyMatrices(renderer.cameras.matrix.matrixWorld, screenLocal);
  screen.object.updateMatrixWorld();

  const hint = document.createElement('div');
  hint.dataset.testid = 'vector-crt-lab';
  hint.style.cssText = [
    'position:absolute',
    'left:12px',
    'top:12px',
    'z-index:2',
    'font:12px/1.4 ui-monospace,monospace',
    'color:#a8d8ff',
    'background:rgba(0,0,0,0.55)',
    'padding:8px 10px',
    'pointer-events:none',
  ].join(';');
  hint.innerHTML =
    '<div>M1.6 Vector CRT</div>' +
    '<div style="opacity:.75">barrel · jitter · flicker · vignette · glass · grain</div>' +
    '<div style="opacity:.6">Hershey simplex · ?debug toggles</div>';
  renderer.canvas.parentElement?.appendChild(hint);

  const root = renderer.canvas.parentElement;
  let lastH = renderer.cssHeight;
  return {
    pass,
    update() {
      if (renderer.cssHeight !== lastH) {
        lastH = renderer.cssHeight;
        layoutScreen();
      }
      screenLocal.makeTranslation(0, -0.62, -SCREEN_DIST);
      screen.transform.multiplyMatrices(renderer.cameras.matrix.matrixWorld, screenLocal);
      screen.object.updateMatrixWorld();
      if (root) {
        root.dataset.vectorBarrel = pass.params.enableBarrel ? '1' : '0';
        root.dataset.vectorFlicker = String(pass.effectiveFlicker);
        root.dataset.hersheyCapPx = String(HERSHEY_CAP_PX);
      }
    },
    dispose() {
      hint.remove();
      if (root) {
        delete root.dataset.vectorBarrel;
        delete root.dataset.vectorFlicker;
        delete root.dataset.hersheyCapPx;
      }
      renderer.scenes.matrix.remove(title.object);
      renderer.scenes.matrix.remove(screen.object);
      title.dispose();
      screen.dispose();
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

function makeGrid(size: number, divs: number, color: Color): LineSegments {
  const verts: number[] = [];
  const h = size * 0.5;
  for (let i = 0; i <= divs; i++) {
    const t = (i / divs) * size - h;
    verts.push(-h, t, 0, h, t, 0);
    verts.push(t, -h, 0, t, h, 0);
  }
  return lines(verts, color);
}

function makeRect(w: number, h: number, color: Color): LineSegments {
  const x = w * 0.5;
  const y = h * 0.5;
  return lines(
    [-x, -y, 0, x, -y, 0, x, -y, 0, x, y, 0, x, y, 0, -x, y, 0, -x, y, 0, -x, -y, 0],
    color,
  );
}

function lines(verts: number[], color: Color): LineSegments {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(verts, 3));
  const mat = new LineBasicMaterial({ color, toneMapped: false });
  const mesh = new LineSegments(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    const mesh = child as LineSegments;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}
