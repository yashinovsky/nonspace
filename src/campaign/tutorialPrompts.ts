import { Matrix4 } from 'three';
import type { Vec3 } from '../core/math/vec3';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import {
  countHersheySegments,
  hersheyBillboard,
  writeHershey,
  type HersheyFont,
} from '../render/text/HersheyText';

export type TutorialPhase = 'look' | 'scan' | 'jump' | 'approach' | 'breach' | 'core' | 'done';

export interface TutorialLabel {
  id: string;
  text: string;
  /** Offset from the ICE origin. */
  ox: number;
  oy: number;
  oz: number;
  phases: readonly TutorialPhase[];
}

/** Diegetic Hershey labels on the clinic ICE facets (plan M7.4). */
export const TUTORIAL_LABELS: readonly TutorialLabel[] = [
  { id: 'scan', text: 'SCAN (F)', ox: 0, oy: 22, oz: 0, phases: ['scan'] },
  { id: 'jump', text: 'PUNCH (TAB)', ox: 0, oy: 22, oz: 0, phases: ['jump'] },
  { id: 'engage', text: 'ENGAGE (LMB)', ox: 0, oy: 16, oz: 0, phases: ['approach'] },
  { id: 'ratio', text: 'RATIO', ox: -16, oy: 8, oz: 10, phases: ['breach'] },
  { id: 'phase', text: 'PHASE', ox: 16, oy: 8, oz: 10, phases: ['breach'] },
  { id: 'lock', text: 'HOLD LOCK', ox: 0, oy: 22, oz: 0, phases: ['breach'] },
  { id: 'download', text: 'HOLD E', ox: 0, oy: 18, oz: 0, phases: ['core'] },
];

const _billboard = new Matrix4();
const _origin: Vec3 = { x: 0, y: 0, z: 0 };

export interface TutorialPrompts {
  readonly batch: BeamBatchGpu;
  phase: TutorialPhase;
  setAnchor(x: number, y: number, z: number): void;
  update(camera: Vec3): void;
  dispose(): void;
}

export function createTutorialPrompts(
  renderer: Renderer,
  font: HersheyFont | null,
): TutorialPrompts {
  let segs = 8;
  if (font) {
    for (const label of TUTORIAL_LABELS) segs += countHersheySegments(font, label.text);
  }
  const batch = createBeamBatch(renderer.palette, {
    capacity: Math.max(segs, 16),
    style: { fogDensity: 0.0004, fogStart: 40, sigma: 0.7, dwell: 0.55, dwellSigma: 1.8 },
  });
  batch.object.name = 'TutorialHershey';
  renderer.scenes.matrix.add(batch.object);

  let ax = 0;
  let ay = 0;
  let az = 0;
  let phase: TutorialPhase = 'look';
  const set = createLineSet(Math.max(segs, 16), { width: true, flags: true });

  const prompts: TutorialPrompts = {
    batch,
    get phase() {
      return phase;
    },
    set phase(next) {
      phase = next;
    },
    setAnchor(x, y, z) {
      ax = x;
      ay = y;
      az = z;
    },
    update(camera) {
      batch.beginDynamic();
      if (font) {
        for (const label of TUTORIAL_LABELS) {
          if (!label.phases.includes(phase)) continue;
          _origin.x = ax + label.ox;
          _origin.y = ay + label.oy;
          _origin.z = az + label.oz;
          hersheyBillboard(_billboard, _origin, camera);
          const n = writeHershey(set, font, label.text, {
            capHeight: 2.4,
            color: Beam.AMBER,
            intensity: 2.2,
            width: 1.7,
            flags: BeamFlag.DWELL,
            align: 'center',
          });
          for (let i = 0; i < n; i++) {
            const o = i * 6;
            const a = applyMat(
              _billboard,
              set.positions[o]!,
              set.positions[o + 1]!,
              set.positions[o + 2]!,
            );
            const b = applyMat(
              _billboard,
              set.positions[o + 3]!,
              set.positions[o + 4]!,
              set.positions[o + 5]!,
            );
            batch.push(a, b, Beam.AMBER, 2.2, 1.7, BeamFlag.DWELL);
          }
        }
      }
      batch.endDynamic();
    },
    dispose() {
      renderer.scenes.matrix.remove(batch.object);
      batch.dispose();
    },
  };
  return prompts;
}

function applyMat(m: Matrix4, x: number, y: number, z: number): Vec3 {
  const e = m.elements;
  const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  const inv = w !== 0 ? 1 / w : 1;
  return {
    x: (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * inv,
    y: (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * inv,
    z: (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * inv,
  };
}
