/**
 * Polygonal ICE-throat tube (Tempest homage, plan §4.4 M5 Phase C).
 * Static rails/rings in T-A emerald; crawlers and the cowboy chevron dynamic.
 */

import { Vector3 } from 'three';
import type { IceModel } from '../breach/IceModel';
import { SCOPE_HZ, TAU, sampleBreaker, sampleTarget, type Figure } from '../breach/PhaseLock';
import type { Renderer } from '../render/Renderer';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  type BeamBatchGpu,
} from '../render/lines/BeamBatch';
import {
  DIVE_GATE_WINDOW,
  DIVE_SEGMENT_LENGTH,
  DIVE_SEGMENTS,
  gateZ,
  laneAngle,
  lanePos,
  type Crawler,
  type DiveState,
} from './diveMath';

const RING_STEP = 4;
const LISSAJOUS_N = 80;
const FLAGS = BeamFlag.DWELL | BeamFlag.NO_FOG;
const _a = new Vector3();
const _b = new Vector3();

export interface DiveTube {
  readonly object: BeamBatchGpu['object'];
  paint(state: DiveState, ice?: IceModel | null, knobs?: { R: number; Phi: number }): void;
  dispose(): void;
}

export function createDiveTube(renderer: Renderer, lanes: number, radius: number): DiveTube {
  const depth = DIVE_SEGMENTS * DIVE_SEGMENT_LENGTH + 16;
  const rings = Math.ceil(depth / RING_STEP) + 1;
  const staticSegs = rings * lanes + lanes * (rings - 1) + DIVE_SEGMENTS * lanes;
  const tube = createBeamBatch(renderer.palette, { capacity: 8 });
  tube.object.name = 'DiveTube';
  const set = createLineSet(staticSegs, { width: true, flags: true });
  let n = 0;
  const write = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    intensity: number,
    w: number,
  ): void => {
    const p = n * 6;
    set.positions[p] = ax;
    set.positions[p + 1] = ay;
    set.positions[p + 2] = az;
    set.positions[p + 3] = bx;
    set.positions[p + 4] = by;
    set.positions[p + 5] = bz;
    set.color[n] = Beam.TA;
    set.intensity[n] = intensity;
    set.width![n] = w;
    set.flags![n] = FLAGS;
    n++;
  };
  for (let r = 0; r < rings; r++) {
    const z = -r * RING_STEP;
    for (let i = 0; i < lanes; i++) {
      const a0 = laneAngle(i, lanes);
      const a1b = ((i + 1) / lanes) * Math.PI * 2 + Math.PI / lanes;
      const x0 = Math.cos(a0) * radius;
      const y0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1b) * radius;
      const y1 = Math.sin(a1b) * radius;
      write(x0, y0, z, x1, y1, z, 0.55, 1.15);
      if (r + 1 < rings) {
        write(x0, y0, z, x0, y0, z - RING_STEP, 0.38, 1.05);
      }
    }
  }
  for (let s = 0; s < DIVE_SEGMENTS; s++) {
    const z = gateZ(s);
    for (let i = 0; i < lanes; i++) {
      const a0 = (i / lanes) * Math.PI * 2 + Math.PI / lanes;
      const a1 = ((i + 1) / lanes) * Math.PI * 2 + Math.PI / lanes;
      write(
        Math.cos(a0) * radius,
        Math.sin(a0) * radius,
        z,
        Math.cos(a1) * radius,
        Math.sin(a1) * radius,
        z,
        1.35,
        1.8,
      );
    }
  }
  tube.setStatic(set);
  renderer.scenes.matrix.add(tube.object);

  const dyn = createBeamBatch(renderer.palette, { capacity: 512 });
  dyn.object.name = 'DiveActors';
  renderer.scenes.matrix.add(dyn.object);

  const targetFig: Figure = { x: new Float32Array(LISSAJOUS_N), y: new Float32Array(LISSAJOUS_N) };
  const breakerFig: Figure = { x: new Float32Array(LISSAJOUS_N), y: new Float32Array(LISSAJOUS_N) };

  const push = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    c: Beam,
    i: number,
    w: number,
    f = FLAGS,
  ): void => {
    _a.set(ax, ay, az);
    _b.set(bx, by, bz);
    dyn.push(_a, _b, c, i, w, f);
  };

  const paintCrawler = (c: Crawler, state: DiveState): void => {
    const p = lanePos(c.lane, state.lanes, radius * 0.92, c.z);
    const a = laneAngle(c.lane, state.lanes);
    const tx = -Math.sin(a) * 0.45;
    const ty = Math.cos(a) * 0.45;
    // Leech pointing toward the camera (up the lane).
    push(p.x + tx, p.y + ty, p.z - 0.7, p.x, p.y, p.z + 0.9, Beam.TA, 2.8, 1.7);
    push(p.x - tx, p.y - ty, p.z - 0.7, p.x, p.y, p.z + 0.9, Beam.TA, 2.8, 1.7);
    push(p.x + tx, p.y + ty, p.z - 0.7, p.x - tx, p.y - ty, p.z - 0.7, Beam.TA, 2.2, 1.3);
  };

  const paintPlayer = (state: DiveState): void => {
    const p = lanePos(state.lane, state.lanes, radius * 0.88, state.z + 0.4);
    const a = laneAngle(state.lane, state.lanes);
    const tx = -Math.sin(a) * 0.55;
    const ty = Math.cos(a) * 0.55;
    const hot = state.invuln > 0 ? 3.6 : 3.1;
    push(p.x + tx, p.y + ty, p.z + 0.35, p.x, p.y, p.z - 0.85, Beam.AMBER, hot, 1.8);
    push(p.x - tx, p.y - ty, p.z + 0.35, p.x, p.y, p.z - 0.85, Beam.AMBER, hot, 1.8);
  };

  const paintGateFigure = (
    state: DiveState,
    ice: IceModel,
    knobs: { R: number; Phi: number },
  ): void => {
    const z = gateZ(state.segment) + 0.2;
    const cur = ice.state.current;
    const [a, b] = cur.ratio;
    const theta = TAU * SCOPE_HZ * state.t;
    sampleTarget(a, b, cur.phi, theta, LISSAJOUS_N, targetFig);
    sampleBreaker(knobs.R, knobs.Phi + cur.roll, a, b, theta, LISSAJOUS_N, breakerFig);
    const s = radius * 0.42;
    for (let i = 1; i < LISSAJOUS_N; i++) {
      push(
        targetFig.x[i - 1]! * s,
        targetFig.y[i - 1]! * s,
        z,
        targetFig.x[i]! * s,
        targetFig.y[i]! * s,
        z,
        Beam.TA,
        3.2,
        1.7,
      );
      push(
        breakerFig.x[i - 1]! * s,
        breakerFig.y[i - 1]! * s,
        z,
        breakerFig.x[i]! * s,
        breakerFig.y[i]! * s,
        z,
        Beam.AMBER,
        3.6,
        1.5,
      );
    }
  };

  return {
    object: tube.object,
    paint(state, ice, knobs) {
      dyn.beginDynamic();
      for (const c of state.crawlers) {
        if (c.alive && c.z < state.z + 6 && c.z > state.z - 70) paintCrawler(c, state);
      }
      paintPlayer(state);
      if (state.phase === 'gate' && ice && knobs) paintGateFigure(state, ice, knobs);
      else {
        // Approach flash on the upcoming gate ring.
        const g = gateZ(state.segment);
        if (state.z - g < DIVE_GATE_WINDOW + 10) {
          const k = 1.8;
          for (let i = 0; i < state.lanes; i++) {
            const a0 = (i / state.lanes) * Math.PI * 2;
            const a1 = ((i + 1) / state.lanes) * Math.PI * 2;
            push(
              Math.cos(a0) * radius,
              Math.sin(a0) * radius,
              g,
              Math.cos(a1) * radius,
              Math.sin(a1) * radius,
              g,
              Beam.TA,
              k,
              2.2,
            );
          }
        }
      }
      dyn.endDynamic();
    },
    dispose() {
      renderer.scenes.matrix.remove(tube.object);
      renderer.scenes.matrix.remove(dyn.object);
      tube.dispose();
      dyn.dispose();
    },
  };
}
