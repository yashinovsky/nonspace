import { Group, Vector3, Mesh, type Camera } from 'three';
import type { IceDef, IceModel } from './IceModel';
import { SCOPE_HZ, TAU, sampleBreaker, sampleTarget, type Figure } from './PhaseLock';
import {
  Beam,
  BeamFlag,
  createBeamBatch,
  createLineSet,
  lineSetCount,
  type BeamBatchGpu,
  type LineSet,
} from '../render/lines/BeamBatch';
import type { Renderer } from '../render/Renderer';
import { createBlackIceMaterial } from '../render/faces/blackIce';
import { asBlackIceComposite } from '../render/post/BlackIceComposite';
import { createUvEdgeMaterial, setUvEdgeTime } from '../render/faces/uvEdge';
import {
  buildShellGeom,
  createFacetMesh,
  createIceFacetMaterial,
  nestedRadii,
  lookFor,
  type IceFaceInfo,
  type IceFacetMaterial,
  type IceShellGeom,
} from '../render/faces/iceFacet';
import { telegraphFlicker } from '../render/faces/iceFacetMath';
import {
  createShatter,
  shatterAlive,
  shatterFade,
  SHATTER_DURATION,
  stepShatter,
  type ShatterSim,
} from '../render/fx/Shatter';

const LISSAJOUS_N = 96;
const GRIP_GROW = 0.45;
const ACTIVE_INTENSITY = 3.4;
const BREAKER_INTENSITY = 3.8;

export { SHATTER_DURATION };

const _a = new Vector3();
const _b = new Vector3();
const _cam = new Vector3();

export interface IceVisuals {
  readonly object: Group;
  readonly blackIceObject: Group;
  readonly def: IceDef;
  readonly shellCount: number;
  readonly shatterTime: number;
  readonly telegraphFlicker: number;
  readonly activeFace: number;
  readonly grip: number;
  update(
    dt: number,
    model: IceModel,
    camera: Camera,
    reduceMotion?: boolean,
    reduceFlashing?: boolean,
  ): void;
  setTime(t: number): void;
  shatter(seed?: number): void;
  dispose(): void;
}

export interface IceVisualsOptions {
  renderer: Renderer;
  def: IceDef;
  x?: number;
  y?: number;
  z?: number;
  /** Drive BlackIceComposite.grip from this visual (black ICE only). */
  driveGrip?: boolean;
}

interface Shell {
  geom: IceShellGeom;
  group: Group;
  facet?: IceFacetMaterial;
  mesh?: Mesh;
  edges: BeamBatchGpu;
  blackMesh?: Mesh;
  blackMat?: ReturnType<typeof createBlackIceMaterial>;
  axis: Vector3;
  spin: number;
}

function axisFor(i: number, counter: boolean): Vector3 {
  const sign = counter && i % 2 === 1 ? -1 : 1;
  if (i % 3 === 0) return new Vector3(0, sign, 0.15 * sign);
  if (i % 3 === 1) return new Vector3(sign * 0.2, 0, sign);
  return new Vector3(sign, 0.25, 0);
}

function pickActiveFace(faces: IceFaceInfo[], camera: Camera, origin: Group): number {
  origin.updateMatrixWorld();
  _cam.setFromMatrixPosition(camera.matrixWorld);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    _a.set(f.center.x, f.center.y, f.center.z).applyMatrix4(origin.matrixWorld);
    _b.set(f.normal.x, f.normal.y, f.normal.z).transformDirection(origin.matrixWorld);
    const dx = _cam.x - _a.x;
    const dy = _cam.y - _a.y;
    const dz = _cam.z - _a.z;
    const score = _b.x * dx + _b.y * dy + _b.z * dz;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function mapFigure(x: number, y: number, face: IceFaceInfo, origin: Group, out: Vector3): Vector3 {
  const s = face.size * 0.72;
  out.set(
    face.center.x + face.tangent.x * x * s + face.bitangent.x * y * s + face.normal.x * 0.04,
    face.center.y + face.tangent.y * x * s + face.bitangent.y * y * s + face.normal.y * 0.04,
    face.center.z + face.tangent.z * x * s + face.bitangent.z * y * s + face.normal.z * 0.04,
  );
  origin.localToWorld(out);
  return out;
}

function bakeLines(set: LineSet, from: Group, into: Group): LineSet {
  from.updateMatrixWorld();
  into.updateMatrixWorld();
  const n = lineSetCount(set);
  const out = createLineSet(n, { width: true, flags: true });
  for (let i = 0; i < n; i++) {
    const p = i * 6;
    _a.set(set.positions[p]!, set.positions[p + 1]!, set.positions[p + 2]!);
    _b.set(set.positions[p + 3]!, set.positions[p + 4]!, set.positions[p + 5]!);
    from.localToWorld(_a);
    from.localToWorld(_b);
    into.worldToLocal(_a);
    into.worldToLocal(_b);
    out.positions[p] = _a.x;
    out.positions[p + 1] = _a.y;
    out.positions[p + 2] = _a.z;
    out.positions[p + 3] = _b.x;
    out.positions[p + 4] = _b.y;
    out.positions[p + 5] = _b.z;
    out.color[i] = set.color[i]!;
    out.intensity[i] = set.intensity[i]!;
    out.width![i] = set.width?.[i] ?? 1.5;
    out.flags![i] = set.flags?.[i] ?? 0;
  }
  return out;
}

/**
 * Nested counter-rotating ICE shells, moiré hatching, active-facet Lissajous
 * beams, shatter, and black-ICE grip tendrils (plan §3.5, §5.4, §5.5, M4.2).
 */
export function createIceVisuals(opts: IceVisualsOptions): IceVisuals {
  const { renderer, def } = opts;
  const look = lookFor(def);
  const iceRgb = { r: 0, g: 0, b: 0 };
  renderer.palette.get(def.hue, iceRgb);

  const object = new Group();
  object.name = `ice:${def.id}`;
  object.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  const blackIceObject = new Group();
  blackIceObject.name = `iceBlack:${def.id}`;
  blackIceObject.position.copy(object.position);

  const radii = nestedRadii(def.radius, look.shells);
  const shells: Shell[] = [];
  const uvMat = def.class === 'black' ? createUvEdgeMaterial() : null;
  const isBlack = def.class === 'black';

  for (let i = 0; i < radii.length; i++) {
    const r = radii[i]!;
    const intensity = look.intensity * (0.7 + 0.3 * (1 - i / radii.length));
    const geom = buildShellGeom(def.shell, r, def.hue, intensity);
    const group = new Group();
    group.name = `shell:${i}`;
    const axis = axisFor(i, look.counterRotate).normalize();
    const spin = look.spin * (look.counterRotate && i % 2 === 1 ? -1 : 1) * (1 - i * 0.08);

    if (isBlack) {
      const blackMat = createBlackIceMaterial();
      const blackMesh = new Mesh(geom.geometry, blackMat);
      blackMesh.frustumCulled = false;
      blackMesh.name = 'iceBlackSolid';
      blackMesh.onBeforeRender = blackMat.userData.syncFrame as Mesh['onBeforeRender'];
      group.add(blackMesh);
      blackIceObject.add(group);
      const edges = createBeamBatch(renderer.palette, {
        material: uvMat!,
        capacity: Math.max(lineSetCount(geom.lines), 8),
      });
      edges.setStatic(geom.lines);
      object.add(edges.object);
      shells.push({ geom, group, edges, blackMesh, blackMat, axis, spin });
    } else {
      const facet = createIceFacetMaterial(iceRgb, look.density, look.width, intensity);
      facet.setAngles(0.18 + i * 0.11, 0.39 + i * 0.13);
      const mesh = createFacetMesh(geom, facet);
      group.add(mesh);
      const edges = createBeamBatch(renderer.palette, {
        capacity: Math.max(lineSetCount(geom.lines), 8),
      });
      edges.setStatic(geom.lines);
      group.add(edges.object);
      object.add(group);
      shells.push({ geom, group, facet, mesh, edges, axis, spin });
    }
  }

  const lissajous = createBeamBatch(renderer.palette, { capacity: LISSAJOUS_N * 2 + 8 });
  object.add(lissajous.object);
  const shatterBatch = createBeamBatch(renderer.palette, { capacity: 512 });
  object.add(shatterBatch.object);

  renderer.scenes.matrix.add(object);
  // Defer the mask RT until grip is live so idle trio frames skip the extra
  // blit (SwiftShader cannot share that cost with sibling e2e workers).
  let maskAttached = false;
  const setMaskAttached = (on: boolean): void => {
    if (!isBlack || on === maskAttached) return;
    if (on) renderer.scenes.blackIce.add(blackIceObject);
    else renderer.scenes.blackIce.remove(blackIceObject);
    maskAttached = on;
  };

  const targetFig: Figure = { x: new Float32Array(LISSAJOUS_N), y: new Float32Array(LISSAJOUS_N) };
  const breakerFig: Figure = { x: new Float32Array(LISSAJOUS_N), y: new Float32Array(LISSAJOUS_N) };

  let time = 0;
  let flickerAmt = 0;
  let flickerNow = 0;
  let activeFace = 0;
  let gripVisual = 0;
  let shatterSim: ShatterSim | null = null;
  let hiddenForShatter = false;
  const driveGrip = opts.driveGrip !== false && isBlack;
  const pass = driveGrip ? asBlackIceComposite(renderer.chain.getPass('blackIce')) : null;

  const setShellVisible = (on: boolean): void => {
    for (const s of shells) {
      s.group.visible = on;
      s.edges.visible = on;
      if (s.blackMesh) s.blackMesh.visible = on;
    }
  };

  const applyRotations = (t: number, reduceMotion: boolean): void => {
    for (const s of shells) {
      const ang = reduceMotion ? 0 : s.spin * t;
      s.group.setRotationFromAxisAngle(s.axis, ang);
      s.group.updateMatrix();
      if (isBlack) {
        s.edges.object.quaternion.copy(s.group.quaternion);
        s.edges.object.updateMatrix();
      }
    }
  };

  const drawLissajous = (model: IceModel, camera: Camera): void => {
    const outer = shells[0];
    if (!outer || hiddenForShatter) {
      lissajous.beginDynamic();
      lissajous.endDynamic();
      return;
    }
    activeFace = pickActiveFace(outer.geom.faces, camera, outer.group);
    const face = outer.geom.faces[activeFace]!;
    for (const s of shells) s.facet?.setActiveFace(activeFace);

    const [a, b] = model.state.current.ratio;
    const theta = TAU * SCOPE_HZ * time;
    sampleTarget(a, b, model.state.current.phi, theta, LISSAJOUS_N, targetFig);
    const R = (b / a) * 0.97;
    sampleBreaker(
      R,
      model.state.current.phi + model.state.current.roll,
      a,
      b,
      theta,
      LISSAJOUS_N,
      breakerFig,
    );

    const hue = def.hue;
    const flick = 1 + flickerNow * 0.8;
    lissajous.beginDynamic();
    for (let i = 1; i < LISSAJOUS_N; i++) {
      mapFigure(targetFig.x[i - 1]!, targetFig.y[i - 1]!, face, outer.group, _a);
      object.worldToLocal(_a);
      mapFigure(targetFig.x[i]!, targetFig.y[i]!, face, outer.group, _b);
      object.worldToLocal(_b);
      lissajous.push(_a, _b, hue, ACTIVE_INTENSITY * flick, 2.1, BeamFlag.NO_FOG | BeamFlag.DWELL);
      mapFigure(breakerFig.x[i - 1]!, breakerFig.y[i - 1]!, face, outer.group, _a);
      object.worldToLocal(_a);
      mapFigure(breakerFig.x[i]!, breakerFig.y[i]!, face, outer.group, _b);
      object.worldToLocal(_b);
      lissajous.push(_a, _b, Beam.GRID, BREAKER_INTENSITY, 1.6, BeamFlag.NO_FOG);
    }
    lissajous.endDynamic();
  };

  const drawShatter = (): void => {
    shatterBatch.beginDynamic();
    if (shatterSim && shatterAlive(shatterSim.elapsed, shatterSim.duration)) {
      const fade = shatterFade(shatterSim.elapsed, shatterSim.duration);
      for (const s of shatterSim.shards) {
        _a.set(s.cx + s.ax, s.cy + s.ay, s.cz + s.az);
        _b.set(s.cx + s.bx, s.cy + s.by, s.cz + s.bz);
        shatterBatch.push(
          _a,
          _b,
          s.color as Beam,
          s.intensity * fade * 2.4,
          Math.max(1.2, s.width),
          s.flags | BeamFlag.DWELL,
        );
      }
    }
    shatterBatch.endDynamic();
  };

  const api: IceVisuals = {
    object,
    blackIceObject,
    def,
    get shellCount() {
      return shells.length;
    },
    get shatterTime() {
      return shatterSim ? shatterSim.elapsed : -1;
    },
    get telegraphFlicker() {
      return flickerNow;
    },
    get activeFace() {
      return activeFace;
    },
    get grip() {
      return gripVisual;
    },
    setTime(t) {
      time = t;
      applyRotations(t, false);
      if (uvMat) setUvEdgeTime(uvMat, t);
    },
    shatter(seed) {
      const outer = shells[0];
      if (!outer) return;
      const baked = bakeLines(outer.geom.lines, isBlack ? outer.edges.object : outer.group, object);
      shatterSim = createShatter(baked, seed);
      hiddenForShatter = true;
      setShellVisible(false);
      lissajous.beginDynamic();
      lissajous.endDynamic();
    },
    update(dt, model, camera, reduceMotion = false, reduceFlashing = false) {
      time += dt;
      flickerAmt = model.state.current.telegraph ? 0.85 : Math.max(0, flickerAmt - dt * 2.5);
      flickerNow = telegraphFlicker(time, flickerAmt, reduceFlashing);
      if (uvMat) setUvEdgeTime(uvMat, reduceMotion ? 0 : time);
      applyRotations(time, reduceMotion);

      const rgb = { r: 0, g: 0, b: 0 };
      renderer.palette.get(def.hue, rgb);
      for (const s of shells) {
        s.facet?.setTime(time);
        s.facet?.setFlicker(flickerAmt);
        s.facet?.setColor(rgb);
      }

      if (shatterSim) {
        stepShatter(shatterSim, dt);
        if (!shatterAlive(shatterSim.elapsed, shatterSim.duration)) {
          shatterSim = null;
          hiddenForShatter = false;
          setShellVisible(true);
        }
      }
      drawShatter();
      drawLissajous(model, camera);

      const g = model.state.grip;
      const target = g ? Math.min(1, (model.state.t - g.start) / GRIP_GROW) : 0;
      const k = 1 - Math.exp(-dt * 8);
      gripVisual += (target - gripVisual) * k;
      if (pass) pass.grip = gripVisual;
      setMaskAttached(!!g || gripVisual > 0.02);
    },
    dispose() {
      if (pass) pass.grip = 0;
      renderer.scenes.matrix.remove(object);
      setMaskAttached(false);
      lissajous.dispose();
      shatterBatch.dispose();
      for (const s of shells) {
        s.edges.dispose();
        s.facet?.dispose();
        s.geom.geometry.dispose();
        s.blackMat?.dispose();
      }
      uvMat?.dispose();
    },
  };
  applyRotations(0, false);
  return api;
}
