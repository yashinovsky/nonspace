/**
 * Dev route `?lab=grammar` (M2.1). Draws LineSet / PointSet / FaceSet with a
 * Three.js fallback so the grammar is testable before M1.1 BeamBatch lands.
 * Query: `?lab=grammar&g=ziggurat&lod=near&seed=1`.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Uint32BufferAttribute,
} from 'three';
import { Pane } from 'tweakpane';
import { BEAM_HEX } from '../../render/palette';
import type { Renderer } from '../../render/Renderer';
import {
  defaultSpec,
  generate,
  isLodLevel,
  parsePrimitiveKind,
  PRIMITIVE_BEAM,
  PRIMITIVE_KINDS,
  segmentBudget,
  type ConstructGeometry,
  type Distribution,
  type LodLevel,
  type PrimitiveKind,
  type PrimitiveSpec,
  type SolidKind,
} from './grammar';

export interface GrammarLab {
  update(dt: number): void;
  dispose(): void;
  readonly kind: PrimitiveKind;
  readonly lod: LodLevel;
  readonly stats: ConstructGeometry['stats'];
  setKind(kind: PrimitiveKind): void;
  setLod(lod: LodLevel): void;
  setSeed(seed: number): void;
}

export interface GrammarLabOptions {
  kind?: string;
  seed?: string;
  lod?: string;
}

export interface GrammarLabHandle {
  kind: PrimitiveKind;
  lod: LodLevel;
  seed: number;
  stats: ConstructGeometry['stats'];
  spec: PrimitiveSpec;
  setKind(kind: PrimitiveKind): void;
  setLod(lod: LodLevel): void;
  setSeed(seed: number): void;
}

declare global {
  interface Window {
    __nonspaceGrammar?: GrammarLabHandle;
  }
}

/** Flat tweakpane-friendly bag. `spiralPitch` avoids clashing with camera pitch. */
interface Tweaks {
  kind: PrimitiveKind;
  lod: LodLevel;
  seed: number;
  spin: boolean;
  yaw: number;
  pitch: number;
  dolly: number;
  showFaces: boolean;
  w: number;
  h: number;
  d: number;
  subdivisions: number;
  hatch: boolean;
  count: number;
  spacing: number;
  symmetry: boolean;
  n: number;
  m: number;
  k: number;
  gap: number;
  steps: number;
  base: number;
  stepH: number;
  inset: number;
  height: number;
  sections: number;
  dishes: number;
  solid: SolidKind;
  shells: number;
  frequency: number;
  radius: number;
  sides: number;
  taper: number;
  rings: number;
  pointsN: number;
  distribution: Distribution;
  arms: number;
  armPoints: number;
  spiralPitch: number;
}

function beamColor(kind: PrimitiveKind, intensity: number): Color {
  const hex = BEAM_HEX[PRIMITIVE_BEAM[kind]]!;
  return new Color().setRGB(
    (((hex >> 16) & 255) / 255) * intensity,
    (((hex >> 8) & 255) / 255) * intensity,
    ((hex & 255) / 255) * intensity,
  );
}

function specFrom(t: Tweaks): PrimitiveSpec {
  switch (t.kind) {
    case 'box':
      return {
        kind: 'box',
        w: t.w,
        h: t.h,
        d: t.d,
        subdivisions: t.subdivisions,
        hatch: t.hatch,
      };
    case 'slabTerrace':
      return {
        kind: 'slabTerrace',
        count: t.count,
        spacing: t.spacing,
        w: t.w,
        h: t.h,
        d: t.d,
        symmetry: t.symmetry,
      };
    case 'cubeStack':
      return { kind: 'cubeStack', n: t.n, m: t.m, k: t.k, gap: t.gap };
    case 'ziggurat':
      return { kind: 'ziggurat', steps: t.steps, base: t.base, stepH: t.stepH, inset: t.inset };
    case 'mast':
      return { kind: 'mast', height: t.height, sections: t.sections, dishes: t.dishes };
    case 'nestedPoly':
      return {
        kind: 'nestedPoly',
        solid: t.solid,
        shells: t.shells,
        rotationAxes: [0, 1, 2],
        radius: t.radius,
        hatch: t.hatch,
      };
    case 'geodesic':
      return { kind: 'geodesic', frequency: t.frequency, radius: t.radius };
    case 'tower':
      return {
        kind: 'tower',
        sides: t.sides,
        height: t.height,
        taper: t.taper,
        rings: t.rings,
      };
    case 'constellation':
      return { kind: 'constellation', n: t.pointsN, distribution: t.distribution };
    case 'spiralArms':
      return { kind: 'spiralArms', arms: t.arms, points: t.armPoints, pitch: t.spiralPitch };
  }
}

function applyDefault(t: Tweaks, kind: PrimitiveKind): void {
  const s = defaultSpec(kind);
  t.kind = kind;
  switch (s.kind) {
    case 'box':
      t.w = s.w;
      t.h = s.h;
      t.d = s.d;
      t.subdivisions = s.subdivisions;
      t.hatch = s.hatch;
      break;
    case 'slabTerrace':
      t.count = s.count;
      t.spacing = s.spacing;
      t.w = s.w;
      t.h = s.h;
      t.d = s.d;
      t.symmetry = s.symmetry;
      break;
    case 'cubeStack':
      t.n = s.n;
      t.m = s.m;
      t.k = s.k;
      t.gap = s.gap;
      break;
    case 'ziggurat':
      t.steps = s.steps;
      t.base = s.base;
      t.stepH = s.stepH;
      t.inset = s.inset;
      break;
    case 'mast':
      t.height = s.height;
      t.sections = s.sections;
      t.dishes = s.dishes;
      break;
    case 'nestedPoly':
      t.solid = s.solid;
      t.shells = s.shells;
      t.radius = s.radius ?? 8;
      t.hatch = s.hatch ?? true;
      break;
    case 'geodesic':
      t.frequency = s.frequency;
      t.radius = s.radius;
      break;
    case 'tower':
      t.sides = s.sides;
      t.height = s.height;
      t.taper = s.taper;
      t.rings = s.rings;
      break;
    case 'constellation':
      t.pointsN = s.n;
      t.distribution = s.distribution;
      break;
    case 'spiralArms':
      t.arms = s.arms;
      t.armPoints = s.points;
      t.spiralPitch = s.pitch;
      break;
  }
}

function disposeObject(root: Group): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
  root.clear();
}

function buildGroup(geom: ConstructGeometry, kind: PrimitiveKind, showFaces: boolean): Group {
  const group = new Group();
  const lineColor = beamColor(kind, 1.15);
  if (geom.stats.segments > 0) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(geom.lines.positions, 3));
    const lines = new LineSegments(
      lg,
      new LineBasicMaterial({ color: lineColor, toneMapped: false }),
    );
    lines.frustumCulled = false;
    group.add(lines);
  }
  if (showFaces && geom.stats.triangles > 0) {
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(geom.faces.positions, 3));
    fg.setIndex(new Uint32BufferAttribute(geom.faces.indices, 1));
    const mesh = new Mesh(
      fg,
      new MeshBasicMaterial({
        color: beamColor(kind, 0.22),
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (geom.stats.points > 0) {
    const pg = new BufferGeometry();
    pg.setAttribute('position', new Float32BufferAttribute(geom.points.positions, 3));
    const pts = new Points(
      pg,
      new PointsMaterial({
        color: beamColor(kind, 1.4),
        size: 3,
        sizeAttenuation: false,
        toneMapped: false,
      }),
    );
    pts.frustumCulled = false;
    group.add(pts);
  }
  return group;
}

export function installGrammarLab(
  renderer: Renderer,
  root: HTMLElement,
  opts: GrammarLabOptions = {},
): GrammarLab {
  const kind0 = parsePrimitiveKind(opts.kind) ?? 'ziggurat';
  const lod0: LodLevel = opts.lod && isLodLevel(opts.lod) ? opts.lod : 'near';
  const seed0 = Number.parseInt(opts.seed ?? '1', 10);
  const t: Tweaks = {
    kind: kind0,
    lod: lod0,
    seed: Number.isFinite(seed0) ? seed0 : 1,
    spin: true,
    yaw: 0.55,
    pitch: 0.38,
    dolly: 2.6,
    showFaces: true,
    w: 8,
    h: 8,
    d: 8,
    subdivisions: 2,
    hatch: true,
    count: 5,
    spacing: 2,
    symmetry: true,
    n: 4,
    m: 4,
    k: 5,
    gap: 0.35,
    steps: 7,
    base: 28,
    stepH: 3,
    inset: 1.8,
    height: 32,
    sections: 6,
    dishes: 3,
    solid: 'octa',
    shells: 3,
    frequency: 2,
    radius: 10,
    sides: 6,
    taper: 0.45,
    rings: 5,
    pointsN: 48,
    distribution: 'cluster',
    arms: 3,
    armPoints: 120,
    spiralPitch: 0.22,
  };
  applyDefault(t, kind0);
  t.lod = lod0;
  t.seed = Number.isFinite(seed0) ? seed0 : 1;

  const cam = renderer.cameras.matrix;
  const saved = {
    x: cam.position.x,
    y: cam.position.y,
    z: cam.position.z,
    near: cam.near,
    far: cam.far,
  };

  const holder = new Group();
  renderer.scenes.matrix.add(holder);

  const readout = {
    segments: '0',
    triangles: '0',
    points: '0',
    budget: '0–0',
  };

  let geom = generate(specFrom(t), { lod: t.lod, seed: t.seed });
  let visual = buildGroup(geom, t.kind, t.showFaces);
  holder.add(visual);

  const frameCamera = (): void => {
    const { min, max } = geom.bounds;
    const ex = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1);
    const dist = ex * t.dolly;
    const cp = Math.cos(t.pitch);
    cam.position.set(
      dist * Math.sin(t.yaw) * cp,
      dist * Math.sin(t.pitch),
      dist * Math.cos(t.yaw) * cp,
    );
    cam.near = Math.max(0.05, ex * 0.01);
    cam.far = Math.max(60_000, ex * 40);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  };

  const statsText = (): void => {
    const b = segmentBudget(t.kind, t.lod);
    readout.segments = String(geom.stats.segments);
    readout.triangles = String(geom.stats.triangles);
    readout.points = String(geom.stats.points);
    readout.budget = `${b.min}–${b.max}`;
  };

  const rebuild = (): void => {
    holder.remove(visual);
    disposeObject(visual);
    geom = generate(specFrom(t), { lod: t.lod, seed: t.seed });
    visual = buildGroup(geom, t.kind, t.showFaces);
    holder.add(visual);
    statsText();
    frameCamera();
    syncHandle();
  };

  const pane = new Pane({ title: 'GRAMMAR  ·  M2.1' });
  pane.element.parentElement?.setAttribute('data-testid', 'grammar-gui');
  const kindOpts = Object.fromEntries(PRIMITIVE_KINDS.map((k) => [k, k]));
  pane.addBinding(t, 'kind', { options: kindOpts, label: 'primitive' }).on('change', (ev) => {
    applyDefault(t, ev.value as PrimitiveKind);
    refreshParams();
    rebuild();
  });
  pane
    .addBinding(t, 'lod', { options: { far: 'far', mid: 'mid', near: 'near' } })
    .on('change', rebuild);
  pane.addBinding(t, 'seed', { min: 0, max: 99999, step: 1 }).on('change', rebuild);
  pane.addBinding(t, 'showFaces', { label: 'faces' }).on('change', rebuild);
  pane.addBinding(t, 'spin');
  pane.addBinding(t, 'yaw', { min: -Math.PI, max: Math.PI }).on('change', frameCamera);
  pane.addBinding(t, 'pitch', { min: 0.05, max: 1.2 }).on('change', frameCamera);
  pane.addBinding(t, 'dolly', { min: 1.4, max: 6, label: 'distance' }).on('change', frameCamera);

  const counts = pane.addFolder({ title: 'counts' });
  counts.addBinding(readout, 'segments', { readonly: true });
  counts.addBinding(readout, 'triangles', { readonly: true });
  counts.addBinding(readout, 'points', { readonly: true });
  counts.addBinding(readout, 'budget', { readonly: true, label: 'seg budget' });

  let paramsFolder = pane.addFolder({ title: 'params' });

  const refreshParams = (): void => {
    paramsFolder.dispose();
    paramsFolder = pane.addFolder({ title: 'params' });
    const p = paramsFolder;
    const ch = (): void => rebuild();
    switch (t.kind) {
      case 'box':
        p.addBinding(t, 'w', { min: 1, max: 40 }).on('change', ch);
        p.addBinding(t, 'h', { min: 1, max: 40 }).on('change', ch);
        p.addBinding(t, 'd', { min: 1, max: 40 }).on('change', ch);
        p.addBinding(t, 'subdivisions', { min: 0, max: 6, step: 1 }).on('change', ch);
        p.addBinding(t, 'hatch').on('change', ch);
        break;
      case 'slabTerrace':
        p.addBinding(t, 'count', { min: 1, max: 12, step: 1 }).on('change', ch);
        p.addBinding(t, 'spacing', { min: 0, max: 8 }).on('change', ch);
        p.addBinding(t, 'w', { min: 4, max: 48 }).on('change', ch);
        p.addBinding(t, 'h', { min: 0.4, max: 8 }).on('change', ch);
        p.addBinding(t, 'd', { min: 2, max: 24 }).on('change', ch);
        p.addBinding(t, 'symmetry').on('change', ch);
        break;
      case 'cubeStack':
        p.addBinding(t, 'n', { min: 1, max: 10, step: 1, label: 'n (x)' }).on('change', ch);
        p.addBinding(t, 'm', { min: 1, max: 10, step: 1, label: 'm (y)' }).on('change', ch);
        p.addBinding(t, 'k', { min: 1, max: 10, step: 1, label: 'k (z)' }).on('change', ch);
        p.addBinding(t, 'gap', { min: 0, max: 0.9 }).on('change', ch);
        break;
      case 'ziggurat':
        p.addBinding(t, 'steps', { min: 2, max: 12, step: 1 }).on('change', ch);
        p.addBinding(t, 'base', { min: 6, max: 60 }).on('change', ch);
        p.addBinding(t, 'stepH', { min: 0.5, max: 8, label: 'step H' }).on('change', ch);
        p.addBinding(t, 'inset', { min: 0, max: 6 }).on('change', ch);
        break;
      case 'mast':
        p.addBinding(t, 'height', { min: 8, max: 80 }).on('change', ch);
        p.addBinding(t, 'sections', { min: 1, max: 12, step: 1 }).on('change', ch);
        p.addBinding(t, 'dishes', { min: 0, max: 6, step: 1 }).on('change', ch);
        break;
      case 'nestedPoly':
        p.addBinding(t, 'solid', { options: { tetra: 'tetra', octa: 'octa', icosa: 'icosa' } }).on(
          'change',
          ch,
        );
        p.addBinding(t, 'shells', { min: 1, max: 6, step: 1 }).on('change', ch);
        p.addBinding(t, 'radius', { min: 2, max: 24 }).on('change', ch);
        p.addBinding(t, 'hatch').on('change', ch);
        break;
      case 'geodesic':
        p.addBinding(t, 'frequency', { min: 1, max: 4, step: 1 }).on('change', ch);
        p.addBinding(t, 'radius', { min: 2, max: 24 }).on('change', ch);
        break;
      case 'tower':
        p.addBinding(t, 'sides', { min: 3, max: 12, step: 1 }).on('change', ch);
        p.addBinding(t, 'height', { min: 6, max: 80 }).on('change', ch);
        p.addBinding(t, 'taper', { min: 0, max: 0.9 }).on('change', ch);
        p.addBinding(t, 'rings', { min: 2, max: 12, step: 1 }).on('change', ch);
        break;
      case 'constellation':
        p.addBinding(t, 'pointsN', { min: 4, max: 256, step: 1, label: 'n' }).on('change', ch);
        p.addBinding(t, 'distribution', {
          options: {
            'uniform-sphere': 'uniform-sphere',
            gaussian: 'gaussian',
            grid: 'grid',
            cluster: 'cluster',
          },
        }).on('change', ch);
        break;
      case 'spiralArms':
        p.addBinding(t, 'arms', { min: 1, max: 6, step: 1 }).on('change', ch);
        p.addBinding(t, 'armPoints', { min: 8, max: 400, step: 1, label: 'points' }).on(
          'change',
          ch,
        );
        p.addBinding(t, 'spiralPitch', { min: 0.05, max: 0.8, label: 'pitch' }).on('change', ch);
        break;
    }
  };

  const overlay = document.createElement('div');
  overlay.dataset.testid = 'grammar-lab';
  overlay.style.cssText =
    'position:fixed;left:1rem;bottom:1rem;z-index:20;pointer-events:none;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#a8d8ff;letter-spacing:0.12em';
  overlay.textContent = 'GRAMMAR  ·  M2.1  ·  Three.js line fallback';
  root.appendChild(overlay);

  const handle: GrammarLabHandle = {
    kind: t.kind,
    lod: t.lod,
    seed: t.seed,
    stats: geom.stats,
    spec: specFrom(t),
    setKind(kind) {
      applyDefault(t, kind);
      refreshParams();
      rebuild();
    },
    setLod(lod) {
      t.lod = lod;
      rebuild();
    },
    setSeed(seed) {
      t.seed = seed;
      rebuild();
    },
  };

  function syncHandle(): void {
    handle.kind = t.kind;
    handle.lod = t.lod;
    handle.seed = t.seed;
    handle.stats = geom.stats;
    handle.spec = specFrom(t);
  }

  refreshParams();
  statsText();
  frameCamera();
  syncHandle();
  window.__nonspaceGrammar = handle;
  root.dataset.lab = 'grammar';
  root.dataset.kind = t.kind;
  root.dataset.lod = t.lod;

  const lab: GrammarLab = {
    get kind() {
      return t.kind;
    },
    get lod() {
      return t.lod;
    },
    get stats() {
      return geom.stats;
    },
    setKind: handle.setKind,
    setLod: handle.setLod,
    setSeed: handle.setSeed,
    update(dt) {
      if (t.spin) {
        t.yaw += dt * 0.22;
        if (t.yaw > Math.PI) t.yaw -= Math.PI * 2;
        frameCamera();
      }
      root.dataset.kind = t.kind;
      root.dataset.lod = t.lod;
      root.dataset.segments = String(geom.stats.segments);
    },
    dispose() {
      pane.dispose();
      overlay.remove();
      renderer.scenes.matrix.remove(holder);
      disposeObject(holder);
      cam.position.set(saved.x, saved.y, saved.z);
      cam.near = saved.near;
      cam.far = saved.far;
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      if (window.__nonspaceGrammar === handle) delete window.__nonspaceGrammar;
    },
  };
  return lab;
}
