/**
 * Dev route `?lab=heraldry` (M2.2). Each authored landmark at its corp
 * heraldry, pulsing on a mock tempo clock. Query: `?lab=heraldry&id=esfa&gray=1`.
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
import { DEFAULT_BPM, createTempoClock, type TempoClock } from '../audio/music/Sequencer';
import type { Beam } from '../render/lines/BeamBatch';
import { BEAM_HEX } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import type { ConstructGeometry } from '../world/constructs/grammar';
import type { CorpPulse } from './corps';
import {
  generateLandmarkParts,
  getLandmark,
  LANDMARK_IDS,
  landmarkPulse,
  landmarkRhythm,
  parseLandmarkId,
  type LandmarkId,
} from './landmarks';

export interface HeraldryLab {
  update(dt: number): void;
  dispose(): void;
  readonly id: LandmarkId;
  setId(id: LandmarkId): void;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
}

export interface HeraldryLabHandle {
  id: LandmarkId;
  t: number;
  bpm: number;
  grayscale: boolean;
  pulse: CorpPulse;
  stats: ConstructGeometry['stats'];
  setId(id: LandmarkId): void;
  setGrayscale(on: boolean): void;
  setTime(t: number): void;
}

declare global {
  interface Window {
    __nonspaceHeraldry?: HeraldryLabHandle;
  }
}

interface Tweaks {
  id: LandmarkId;
  grayscale: boolean;
  play: boolean;
  bpm: number;
  yaw: number;
  pitch: number;
  dolly: number;
}

function beamColor(beam: number, intensity: number, gray: boolean): Color {
  const hex = BEAM_HEX[beam as Beam] ?? 0xa8d8ff;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  if (gray) {
    const y = Math.min(1, (0.2126 * r + 0.7152 * g + 0.0722 * b) * intensity);
    return new Color().setRGB(y, y, y);
  }
  return new Color().setRGB(
    Math.min(1, r * intensity),
    Math.min(1, g * intensity),
    Math.min(1, b * intensity),
  );
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

interface PartView {
  group: Group;
  beam: number;
  baseIntensity: number;
  lineMat?: LineBasicMaterial;
  faceMat?: MeshBasicMaterial;
  pointMat?: PointsMaterial;
}

function buildPart(geom: ConstructGeometry, gray: boolean): PartView {
  const group = new Group();
  const beam = geom.lines.color[0] ?? geom.points.color[0] ?? 0;
  const baseIntensity = geom.lines.intensity[0] ?? geom.points.intensity[0] ?? 1;
  const view: PartView = { group, beam, baseIntensity };
  if (geom.stats.segments > 0) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(geom.lines.positions, 3));
    const lineMat = new LineBasicMaterial({
      color: beamColor(beam, baseIntensity, gray),
      toneMapped: false,
    });
    const lines = new LineSegments(lg, lineMat);
    lines.frustumCulled = false;
    group.add(lines);
    view.lineMat = lineMat;
  }
  if (geom.stats.triangles > 0) {
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(geom.faces.positions, 3));
    fg.setIndex(new Uint32BufferAttribute(geom.faces.indices, 1));
    const faceMat = new MeshBasicMaterial({
      color: beamColor(beam, 0.22, gray),
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(fg, faceMat);
    mesh.frustumCulled = false;
    group.add(mesh);
    view.faceMat = faceMat;
  }
  if (geom.stats.points > 0) {
    const pg = new BufferGeometry();
    pg.setAttribute('position', new Float32BufferAttribute(geom.points.positions, 3));
    const pointMat = new PointsMaterial({
      color: beamColor(beam, 1.4, gray),
      size: 3,
      sizeAttenuation: false,
      toneMapped: false,
    });
    const pts = new Points(pg, pointMat);
    pts.frustumCulled = false;
    group.add(pts);
    view.pointMat = pointMat;
  }
  return view;
}

function ringGeometry(radius: number, segs = 32): BufferGeometry {
  const pos = new Float32Array(segs * 2 * 3);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const o = i * 6;
    pos[o] = Math.cos(a0) * radius;
    pos[o + 1] = 0;
    pos[o + 2] = Math.sin(a0) * radius;
    pos[o + 3] = Math.cos(a1) * radius;
    pos[o + 4] = 0;
    pos[o + 5] = Math.sin(a1) * radius;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export interface HeraldryLabOptions {
  id?: string;
  gray?: string;
  bpm?: string;
}

export function installHeraldryLab(
  renderer: Renderer,
  root: HTMLElement,
  opts: HeraldryLabOptions = {},
): HeraldryLab {
  const id0 = parseLandmarkId(opts.id) ?? 'esfa';
  const bpm0 = Number.parseFloat(opts.bpm ?? '');
  const t: Tweaks = {
    id: id0,
    grayscale: opts.gray === '1' || opts.gray === 'true',
    play: true,
    bpm: Number.isFinite(bpm0) && bpm0 > 0 ? bpm0 : DEFAULT_BPM,
    yaw: 0.62,
    pitch: 0.42,
    dolly: 2.7,
  };

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
  const extras = new Group();
  holder.add(extras);

  let clock: TempoClock = createTempoClock(t.bpm, 0);
  let simT = 0;
  let pulse = landmarkPulse(t.id, 0, clock);
  let parts: ConstructGeometry[] = [];
  let views: PartView[] = [];
  let lastEighth = -1;
  let lastId: LandmarkId | null = null;
  let lastGray = t.grayscale;

  const ring = new LineSegments(
    ringGeometry(1),
    new LineBasicMaterial({ color: 0xffb000, toneMapped: false, transparent: true, opacity: 0.8 }),
  );
  ring.visible = false;
  extras.add(ring);

  const sweepGeom = new BufferGeometry();
  sweepGeom.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 14]), 3),
  );
  const sweep = new LineSegments(
    sweepGeom,
    new LineBasicMaterial({ color: 0xb9a6ff, toneMapped: false }),
  );
  sweep.visible = false;
  extras.add(sweep);

  const frameCamera = (): void => {
    let ex = 8;
    for (const g of parts) {
      const { min, max } = g.bounds;
      ex = Math.max(ex, max.x - min.x, max.y - min.y, max.z - min.z, 1);
    }
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

  const applyPulse = (): void => {
    const def = getLandmark(t.id);
    for (let i = 0; i < views.length; i++) {
      const view = views[i]!;
      const heart = def?.rhythm === 'listen' && i === 1;
      const mul = heart ? pulse.heart / 2.6 : pulse.intensity;
      view.lineMat?.color.copy(beamColor(view.beam, view.baseIntensity * mul, t.grayscale));
      view.faceMat?.color.copy(beamColor(view.beam, 0.22 * mul, t.grayscale));
      view.pointMat?.color.copy(beamColor(view.beam, 1.4 * mul, t.grayscale));
      view.group.rotation.y = pulse.yaw * (i === 0 ? 1 : -0.7);
      view.group.rotation.x = pulse.pitch * (i === 0 ? 0.4 : 1);
      view.group.position.y = def?.corp === 'esfa' ? pulse.jitter : 0;
    }
    ring.visible = def?.corp === 'senseNet' && pulse.ring > 0.02;
    if (ring.visible) {
      const r = 6 + pulse.ring * 18;
      ring.scale.set(r, 1, r);
      (ring.material as LineBasicMaterial).opacity = Math.max(0, 1 - pulse.ring);
      if (t.grayscale) (ring.material as LineBasicMaterial).color.setRGB(0.7, 0.7, 0.7);
      else (ring.material as LineBasicMaterial).color.setHex(0xffb000);
    }
    sweep.visible = def?.corp === 'turing';
    if (sweep.visible) sweep.rotation.y = pulse.yaw;
  };

  const rebuild = (force: boolean): void => {
    const ledger = landmarkRhythm(getLandmark(t.id)!) === 'ledger';
    const eighthChanged = ledger && pulse.eighth !== lastEighth;
    const idChanged = t.id !== lastId;
    const grayChanged = t.grayscale !== lastGray;
    if (!force && !idChanged && !grayChanged && !eighthChanged) return;
    for (const v of views) {
      holder.remove(v.group);
      disposeObject(v.group);
    }
    views = [];
    parts = generateLandmarkParts(t.id, { lod: 'near', t: simT, tempo: clock, seed: 1 });
    for (const geom of parts) {
      const view = buildPart(geom, t.grayscale);
      holder.add(view.group);
      views.push(view);
    }
    lastEighth = pulse.eighth;
    lastId = t.id;
    lastGray = t.grayscale;
    applyPulse();
    frameCamera();
    syncHandle();
  };

  const pane = new Pane({ title: 'HERALDRY  ·  M2.2' });
  pane.element.parentElement?.setAttribute('data-testid', 'heraldry-gui');
  const idOpts = Object.fromEntries(LANDMARK_IDS.map((id) => [id, id]));
  pane.addBinding(t, 'id', { options: idOpts, label: 'landmark' }).on('change', () => {
    rebuild(true);
  });
  pane.addBinding(t, 'grayscale').on('change', () => rebuild(true));
  pane.addBinding(t, 'play');
  pane.addBinding(t, 'bpm', { min: 40, max: 160, step: 1 }).on('change', () => {
    clock = createTempoClock(t.bpm, 0);
  });
  pane.addBinding(t, 'yaw', { min: -Math.PI, max: Math.PI }).on('change', frameCamera);
  pane.addBinding(t, 'pitch', { min: 0.05, max: 1.2 }).on('change', frameCamera);
  pane.addBinding(t, 'dolly', { min: 1.4, max: 6 }).on('change', frameCamera);

  const overlay = document.createElement('div');
  overlay.dataset.testid = 'heraldry-lab';
  overlay.style.cssText = 'position:fixed;left:8px;bottom:8px;color:#a8d8ff';
  overlay.textContent = 'HERALDRY';
  root.appendChild(overlay);

  const handle: HeraldryLabHandle = {
    id: t.id,
    t: 0,
    bpm: t.bpm,
    grayscale: t.grayscale,
    pulse,
    stats: { segments: 0, triangles: 0, points: 0 },
    setId(id) {
      t.id = id;
      rebuild(true);
    },
    setGrayscale(on) {
      t.grayscale = on;
      rebuild(true);
    },
    setTime(time) {
      simT = time;
      t.play = false;
      pulse = landmarkPulse(t.id, simT, clock);
      rebuild(true);
    },
  };

  function syncHandle(): void {
    handle.id = t.id;
    handle.t = simT;
    handle.bpm = t.bpm;
    handle.grayscale = t.grayscale;
    handle.pulse = pulse;
    let segs = 0,
      tris = 0,
      pts = 0;
    for (const g of parts) {
      segs += g.stats.segments;
      tris += g.stats.triangles;
      pts += g.stats.points;
    }
    handle.stats = { segments: segs, triangles: tris, points: pts };
  }

  rebuild(true);
  window.__nonspaceHeraldry = handle;
  root.dataset.lab = 'heraldry';
  root.dataset.landmark = t.id;
  root.dataset.grayscale = t.grayscale ? '1' : '0';

  const lab: HeraldryLab = {
    get id() {
      return t.id;
    },
    setId: handle.setId,
    setGrayscale: handle.setGrayscale,
    setTime: handle.setTime,
    update(dt) {
      if (t.play) simT += dt;
      pulse = landmarkPulse(t.id, simT, clock);
      rebuild(false);
      applyPulse();
      frameCamera();
      root.dataset.landmark = t.id;
      root.dataset.grayscale = t.grayscale ? '1' : '0';
      root.dataset.intensity = pulse.intensity.toFixed(3);
      overlay.textContent = `HERALDRY  ·  ${t.id}`;
      syncHandle();
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
      if (window.__nonspaceHeraldry === handle) delete window.__nonspaceHeraldry;
    },
  };
  return lab;
}
