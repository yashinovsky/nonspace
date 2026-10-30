/// <reference types="vite-plugin-glsl/ext" />
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  LineSegments,
  Matrix4,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Beam } from '../lines/BeamBatch';
import { createGroundGrid, type GroundGrid } from '../grid/GroundGrid';
import { createPointBatch, createPointSet, type GpuPointBatch } from '../points/PointBatch';
import type { Renderer } from '../Renderer';
import { createVfdText, type VfdText } from '../text/VfdText';
import { FALLBACK_LANDMARKS } from '../../world/landmarks';
import origamiFoldVert from './origamiFold.vert';
import origamiFoldFrag from './origamiFold.frag';
import phosphenesVert from './phosphenes.vert';
import phosphenesFrag from './phosphenes.frag';

/** Plan §5.9. */
export const JACK_IN_FULL = 5.5;
export const JACK_IN_SHORT = 1.2;
export const JACK_IN_SEEN_FLAG = 'jackInSeen';
export const ORIGAMI_PANELS = 8;
export const PHOSPHENE_COUNT = 720;
export const GRID_RACE_START = 6;
export const GRID_RACE_END = 22_000;

export type JackInVariant = 'full' | 'short';
export type JackInPhase =
  'black' | 'phosphenes' | 'origami' | 'race' | 'landmarks' | 'hud' | 'done';

export function jackInDuration(variant: JackInVariant): number {
  return variant === 'short' ? JACK_IN_SHORT : JACK_IN_FULL;
}

/** Normalized windows inside the duration. Inclusive start, exclusive end. */
export const JACK_IN_PHASES = {
  black: [0, 0.07],
  phosphenes: [0.03, 0.4],
  origami: [0.18, 0.58],
  race: [0.42, 0.82],
  landmarks: [0.62, 0.9],
  hud: [0.78, 1],
} as const;

export interface JackInSample {
  /** Elapsed / duration, clamped 0..1+. */
  u: number;
  phosphene: number;
  /** 0..1 fold progress (shader uses ×π). */
  fold: number;
  radius: number;
  landmark: number;
  hud: number;
  /** Large-area luma estimate for the flash rule. */
  luma: number;
  phase: JackInPhase;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Smooth pulse: 0 outside [a,b], 1 on the inner plateau. */
export function envelope(u: number, a: number, b: number, fade = 0.07): number {
  if (b <= a) return 0;
  const fin = Math.min(fade, (b - a) * 0.45);
  return smoothstep(a, a + fin, u) * (1 - smoothstep(b - fin, b, u));
}

function phaseOf(u: number): JackInPhase {
  if (u >= 1) return 'done';
  if (u >= JACK_IN_PHASES.hud[0]) return 'hud';
  if (u >= JACK_IN_PHASES.landmarks[0]) return 'landmarks';
  if (u >= JACK_IN_PHASES.race[0]) return 'race';
  if (u >= JACK_IN_PHASES.origami[0]) return 'origami';
  if (u >= JACK_IN_PHASES.phosphenes[0]) return 'phosphenes';
  return 'black';
}

export function gridRaceRadius(progress: number): number {
  const p = clamp01(progress);
  return GRID_RACE_START * Math.exp(p * Math.log(GRID_RACE_END / GRID_RACE_START));
}

/**
 * Sample the 5.5 s / 1.2 s beat. Envelopes are smoothstepped — no strobe.
 * `reduceFlashing` clamps phosphene amplitude (plan §5.9 / §8.10).
 */
export function sampleJackIn(
  elapsed: number,
  duration: number,
  reduceFlashing = false,
): JackInSample {
  const d = duration > 0 ? duration : JACK_IN_FULL;
  const u = elapsed / d;
  const phosphene = envelope(u, JACK_IN_PHASES.phosphenes[0], JACK_IN_PHASES.phosphenes[1], 0.08);
  const fold = smoothstep(JACK_IN_PHASES.origami[0], JACK_IN_PHASES.origami[1], u);
  const race = smoothstep(JACK_IN_PHASES.race[0], JACK_IN_PHASES.race[1], u);
  const landmark = smoothstep(JACK_IN_PHASES.landmarks[0], JACK_IN_PHASES.landmarks[1], u);
  const hud = smoothstep(JACK_IN_PHASES.hud[0], JACK_IN_PHASES.hud[1], u);
  const phosAmp = reduceFlashing ? 0.28 : 1;
  const foldVis = Math.sin(fold * Math.PI);
  const luma =
    0.045 * phosphene * phosAmp + 0.11 * foldVis + 0.16 * race + 0.05 * landmark + 0.025 * hud;
  return {
    u: Math.max(0, u),
    phosphene: phosphene * phosAmp,
    fold,
    radius: u <= 0 ? 0.5 : gridRaceRadius(race),
    landmark,
    hud,
    luma,
    phase: phaseOf(u),
  };
}

export function sampleJackInLuma(duration: number, fps = 60, reduceFlashing = false): number[] {
  const n = Math.max(1, Math.round(duration * fps));
  const dt = 1 / fps;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(sampleJackIn(i * dt, duration, reduceFlashing).luma);
  return out;
}

/** Rising-edge crossings of `threshold` — same idea as raster CRT's flash audit. */
export function countFlashes(samples: readonly number[], threshold: number): number {
  let flashes = 0;
  let above = false;
  for (const s of samples) {
    if (!above && s >= threshold) {
      above = true;
      flashes += 1;
    } else if (above && s < threshold) {
      above = false;
    }
  }
  return flashes;
}

export function canSkipJackIn(seen: boolean): boolean {
  return seen;
}

const HUD_LINES = ['ONO-SENDAI', 'CYBERSPACE 7', 'READY'];
const CAM_POS = { x: 0, y: 16.5, z: 48 };
const CAM_LOOK = { x: 0, y: 0, z: -24 };
const SCREEN_DIST = 2.45;
const screenLocal = new Matrix4();
const camPos = new Vector3();

function logDepthFC(far: number): number {
  return 2 / (Math.log(far + 1) / Math.LN2);
}

function buildOrigamiGeometry(): BufferGeometry {
  const pos: number[] = [];
  const panel: number[] = [];
  const shade: number[] = [];
  const half = 40;
  const depth = 56;
  const step = 8;
  for (let p = 0; p < ORIGAMI_PANELS; p++) {
    for (let x = -half; x <= half; x += step) {
      pos.push(x, 0, 0, x, depth, 0);
      panel.push(p, p);
      const s = 0.45 + 0.55 * (1 - Math.abs(x) / half);
      shade.push(s, s);
    }
    for (let y = 0; y <= depth; y += step) {
      pos.push(-half, y, 0, half, y, 0);
      panel.push(p, p);
      const s = 0.35 + 0.65 * (y / depth);
      shade.push(s, s);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aPanel', new BufferAttribute(new Float32Array(panel), 1));
  geo.setAttribute('aShade', new BufferAttribute(new Float32Array(shade), 1));
  return geo;
}

function fillLandmarkSet(): ReturnType<typeof createPointSet> {
  const n = FALLBACK_LANDMARKS.length;
  const set = createPointSet(n, { size: true });
  for (let i = 0; i < n; i++) {
    const lm = FALLBACK_LANDMARKS[i]!;
    const dist = 420 + lm.importance * 240;
    const ang = (i / n) * 1.15 - 0.55;
    set.positions[i * 3] = Math.sin(ang) * dist;
    set.positions[i * 3 + 1] = Math.min(90, lm.y * 0.012);
    set.positions[i * 3 + 2] = -dist;
    set.color[i] = lm.color & 7;
    set.intensity[i] = 0;
    set.size![i] = 2.4 + lm.importance * 0.45;
  }
  return set;
}

function hudText(progress: number): string {
  const chars = HUD_LINES.join('\n');
  if (progress <= 0) return '';
  const n = Math.max(1, Math.ceil(progress * chars.length));
  return chars.slice(0, n);
}

export interface JackInSequence {
  readonly duration: number;
  readonly variant: JackInVariant;
  time: number;
  reduceFlashing: boolean;
  readonly done: boolean;
  readonly sample: JackInSample;
  mount(renderer: Renderer): void;
  unmount(): void;
  seek(time: number): void;
  update(dt: number): void;
  apply(): void;
  dispose(): void;
}

export interface JackInSequenceOptions {
  variant?: JackInVariant;
  reduceFlashing?: boolean;
}

export function createJackInSequence(opts: JackInSequenceOptions = {}): JackInSequence {
  const variant = opts.variant === 'short' ? 'short' : 'full';
  const duration = jackInDuration(variant);
  let time = 0;
  let reduceFlashing = opts.reduceFlashing ?? false;
  let sample = sampleJackIn(0, duration, reduceFlashing);
  let renderer: Renderer | null = null;
  let grid: GroundGrid | null = null;
  let origami: LineSegments | null = null;
  let origamiMat: ShaderMaterial | null = null;
  let phos: Points | null = null;
  let phosMat: ShaderMaterial | null = null;
  let landmarks: GpuPointBatch | null = null;
  let landmarkSet = fillLandmarkSet();
  let vfd: VfdText | null = null;
  let lastHud = '';

  const syncSample = (): void => {
    sample = sampleJackIn(time, duration, reduceFlashing);
  };

  const placeCamera = (): void => {
    const cam = renderer?.cameras.matrix;
    if (!cam) return;
    cam.near = 0.5;
    cam.far = 60_000;
    cam.fov = 75;
    cam.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    cam.lookAt(CAM_LOOK.x, CAM_LOOK.y, CAM_LOOK.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };

  const api: JackInSequence = {
    duration,
    variant,
    get time() {
      return time;
    },
    set time(v) {
      api.seek(v);
    },
    get reduceFlashing() {
      return reduceFlashing;
    },
    set reduceFlashing(v) {
      reduceFlashing = v;
      syncSample();
    },
    get done() {
      return time >= duration;
    },
    get sample() {
      return sample;
    },
    mount(next) {
      renderer = next;
      placeCamera();
      grid = createGroundGrid(next.palette);
      grid.setRadius(0.5);
      next.scenes.matrix.add(grid.object);

      const fold = new Float32Array(ORIGAMI_PANELS);
      origamiMat = new ShaderMaterial({
        name: 'origamiFold',
        glslVersion: GLSL3,
        vertexShader: origamiFoldVert,
        fragmentShader: origamiFoldFrag,
        uniforms: {
          uFold: { value: fold },
          uPalette: next.palette.uniform,
          uGain: { value: 0 },
          logDepthBufFC: { value: logDepthFC(60_000) },
        },
        depthTest: true,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
        blending: AdditiveBlending,
      });
      origami = new LineSegments(buildOrigamiGeometry(), origamiMat);
      origami.frustumCulled = false;
      origami.renderOrder = 2;
      origami.name = 'OrigamiFold';
      next.scenes.matrix.add(origami);

      const seeds = new Float32Array(PHOSPHENE_COUNT);
      for (let i = 0; i < PHOSPHENE_COUNT; i++) seeds[i] = (i + 0.5) / PHOSPHENE_COUNT;
      const phosGeo = new BufferGeometry();
      phosGeo.setAttribute('aSeed', new BufferAttribute(seeds, 1));
      phosGeo.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(PHOSPHENE_COUNT * 3), 3),
      );
      phosMat = new ShaderMaterial({
        name: 'phosphenes',
        glslVersion: GLSL3,
        vertexShader: phosphenesVert,
        fragmentShader: phosphenesFrag,
        uniforms: {
          uTime: { value: 0 },
          uAmount: { value: 0 },
          uAmp: { value: reduceFlashing ? 0.22 : 0.55 },
          uResolution: { value: { x: next.internalWidth, y: next.internalHeight } },
        },
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
        blending: AdditiveBlending,
      });
      phos = new Points(phosGeo, phosMat);
      phos.frustumCulled = false;
      phos.renderOrder = 8;
      phos.name = 'Phosphenes';
      next.scenes.matrix.add(phos);

      landmarkSet = fillLandmarkSet();
      landmarks = createPointBatch({
        capacity: landmarkSet.color.length,
        palette: next.palette,
        fogDensity: 0.00008,
        refDistance: 220,
      });
      landmarks.setStatic(landmarkSet);
      landmarks.visible = false;
      next.scenes.matrix.add(landmarks.object);

      vfd = createVfdText(next.palette, { capacity: 48, ghost: true, size: 0.11 });
      vfd.visible = false;
      next.scenes.matrix.add(vfd.object);

      syncSample();
      api.apply();
    },
    unmount() {
      const r = renderer;
      if (grid) {
        r?.scenes.matrix.remove(grid.object);
        grid.dispose();
        grid = null;
      }
      if (origami) {
        r?.scenes.matrix.remove(origami);
        origami.geometry.dispose();
        origamiMat?.dispose();
        origami = null;
        origamiMat = null;
      }
      if (phos) {
        r?.scenes.matrix.remove(phos);
        phos.geometry.dispose();
        phosMat?.dispose();
        phos = null;
        phosMat = null;
      }
      if (landmarks) {
        r?.scenes.matrix.remove(landmarks.object);
        landmarks.dispose();
        landmarks = null;
      }
      if (vfd) {
        r?.scenes.matrix.remove(vfd.object);
        vfd.dispose();
        vfd = null;
      }
      lastHud = '';
      renderer = null;
    },
    seek(next) {
      time = Math.max(0, next);
      syncSample();
    },
    update(dt) {
      if (!(dt > 0) || time >= duration) {
        if (time >= duration) {
          time = duration;
          syncSample();
        }
        return;
      }
      time = Math.min(duration, time + dt);
      syncSample();
    },
    apply() {
      const r = renderer;
      if (!r) return;
      placeCamera();
      const s = sample;
      grid?.setRadius(s.radius);
      grid?.follow(r.cameras.matrix.position);

      if (origamiMat) {
        const folds = origamiMat.uniforms.uFold!.value as Float32Array;
        for (let i = 0; i < ORIGAMI_PANELS; i++) {
          const local = clamp01((s.fold - i * 0.035) / 0.78);
          folds[i] = local * Math.PI;
        }
        origamiMat.uniforms.uGain!.value = s.fold > 0.02 && s.fold < 0.98 ? 1.15 : 0;
        origamiMat.uniforms.logDepthBufFC!.value = logDepthFC(r.cameras.matrix.far);
        origami!.visible = s.fold > 0.01 && s.fold < 0.97;
      }

      if (phosMat) {
        phosMat.uniforms.uTime!.value = time;
        phosMat.uniforms.uAmount!.value = s.phosphene;
        phosMat.uniforms.uAmp!.value = reduceFlashing ? 0.22 : 0.55;
        (phosMat.uniforms.uResolution!.value as { x: number; y: number }).x = r.internalWidth;
        (phosMat.uniforms.uResolution!.value as { x: number; y: number }).y = r.internalHeight;
        phos!.visible = s.phosphene > 0.002;
      }

      if (landmarks) {
        const n = landmarkSet.color.length;
        for (let i = 0; i < n; i++)
          landmarkSet.intensity[i] = s.landmark * (0.8 + 0.6 * (i % 3 === 0 ? 1 : 0.7));
        landmarks.setStatic(landmarkSet);
        landmarks.setViewport(r.internalWidth, r.internalHeight);
        landmarks.visible = s.landmark > 0.01;
      }

      if (vfd) {
        const text = s.hud > 0.02 ? hudText(s.hud) : '';
        if (text !== lastHud) {
          lastHud = text;
          vfd.setText(text, {
            color: Beam.AMBER,
            intensity: 0.55 + 1.1 * s.hud,
            size: 0.11,
            mode: 14,
            ghost: true,
            align: 'center',
          });
        }
        vfd.visible = s.hud > 0.02 && text.length > 0;
        const cam = r.cameras.matrix;
        cam.getWorldPosition(camPos);
        screenLocal.makeTranslation(0, -0.72, -SCREEN_DIST);
        vfd.transform.multiplyMatrices(cam.matrixWorld, screenLocal);
        vfd.object.updateMatrixWorld();
      }
    },
    dispose() {
      api.unmount();
    },
  };
  return api;
}
