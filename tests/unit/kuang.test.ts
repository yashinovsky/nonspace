import { describe, expect, it } from 'vitest';
import { ICE_LAYER_PRESETS } from '../../src/content/ice/presets';
import { TA_ICE } from '../../src/content/ice/ta';
import { getSoft, SOFTS } from '../../src/content/softs';
import { createIceModel } from '../../src/breach/IceModel';
import { matchMetric, stepLockMeter } from '../../src/breach/PhaseLock';
import { BeamFlag } from '../../src/render/lines/BeamBatch';
import {
  isOffPalette,
  kuangRgb,
  spectrumRgb,
  TA_RGB,
  thinFilm,
} from '../../src/render/lines/kuangMath';
import {
  clampLanes,
  clearGate,
  createDiveState,
  crawlerHits,
  DIVE_LANE_MAX,
  DIVE_LANE_MIN,
  DIVE_SEGMENTS,
  DIVE_SPEED,
  gateZ,
  KUANG_GATE_LOCK_TIME,
  KUANG_GATE_TOL,
  laneAngle,
  stepDive,
  stepLane,
  wrapLane,
} from '../../src/world/diveMath';
import {
  coilControls,
  deployControls,
  revealedRibs,
  ribCount,
  sampleSpline,
  writeRib,
  type RibHit,
  type SplineSample,
} from '../../src/world/kuangSpline';

describe('Kuang spectrum', () => {
  it('is off the 8-hue beam palette at mimic 0', () => {
    let unique = 0;
    for (let i = 0; i < 12; i++) {
      const rgb = spectrumRgb(i / 11);
      if (isOffPalette(rgb, 0.2)) unique++;
    }
    expect(unique).toBeGreaterThan(3);
    const film = thinFilm(0.7, 0.4, 0.2);
    expect(film).toBeGreaterThanOrEqual(0);
    expect(film).toBeLessThan(1);
  });

  it('matches T-A emerald at mimic 1', () => {
    const rgb = kuangRgb(0.6, 0.35, 1.2, 1);
    expect(rgb.r).toBeCloseTo(TA_RGB.r, 5);
    expect(rgb.g).toBeCloseTo(TA_RGB.g, 5);
    expect(rgb.b).toBeCloseTo(TA_RGB.b, 5);
  });
});

describe('Kuang spline ribs', () => {
  it('samples a deploy spline and writes closed rings', () => {
    const pts = deployControls();
    expect(pts.length).toBeGreaterThanOrEqual(4);
    const s: SplineSample = { x: 0, y: 0, z: 0, tx: 0, ty: 1, tz: 0 };
    sampleSpline(pts, 0, s);
    sampleSpline(pts, 1, s);
    expect(Math.hypot(s.tx, s.ty, s.tz)).toBeCloseTo(1, 5);
    const ribs: RibHit[] = [];
    const n = writeRib(s, 0.5, 8, ribs, 0);
    expect(n).toBe(8);
    expect(ribs[0]!.ax).toBeCloseTo(ribs[7]!.bx, 5);
    expect(ribCount(36, 10)).toBe(360);
    expect(revealedRibs(36, 0)).toBe(0);
    expect(revealedRibs(36, 1)).toBe(36);
    expect(coilControls(8, 0, 20).length).toBeGreaterThanOrEqual(4);
  });
});

describe('tube dive', () => {
  it('clamps lanes to 8–16 and wraps', () => {
    expect(clampLanes(3)).toBe(DIVE_LANE_MIN);
    expect(clampLanes(99)).toBe(DIVE_LANE_MAX);
    expect(wrapLane(-1, 12)).toBe(11);
    expect(wrapLane(12, 12)).toBe(0);
    expect(laneAngle(0, 12)).toBeCloseTo(Math.PI / 12, 6);
  });

  it('steps one lane per press at constant forward speed', () => {
    const st = createDiveState({ lanes: 12, seed: 2 });
    const z0 = st.z;
    const lane0 = st.lane;
    const a = stepLane(st.lane, st.lanes, 1, false, 0, 1 / 60);
    expect(a.stepped).toBe(true);
    expect(a.lane).toBe(wrapLane(lane0 + 1, 12));
    const held = stepLane(a.lane, st.lanes, 1, true, 0.2, 1 / 60);
    expect(held.stepped).toBe(false);
    const moved = stepDive(st, { strafe: 0, dt: 1 });
    expect(moved.hit || !moved.hit).toBe(true);
    expect(st.z).toBeCloseTo(z0 - DIVE_SPEED, 5);
    expect(st.speed).toBe(DIVE_SPEED);
  });

  it('opens three gates with kuang-gate Phase Lock tolerance', () => {
    expect(KUANG_GATE_TOL).toBe(ICE_LAYER_PRESETS['kuang-gate'].tolRatio);
    expect(KUANG_GATE_TOL).toBeGreaterThan(ICE_LAYER_PRESETS['gray-2'].tolRatio);
    expect(DIVE_SEGMENTS).toBe(3);
    const ice = createIceModel(TA_ICE, { seed: 11 });
    ice.engage();
    expect(ice.def.layers[0]!.tolRatio).toBe(KUANG_GATE_TOL);
    const [a, b] = ice.state.current.ratio;
    const m = matchMetric(
      b / a,
      ice.state.current.phi,
      a,
      b,
      ice.state.current.phi,
      KUANG_GATE_TOL,
    );
    expect(m).toBeCloseTo(1, 5);
    expect(stepLockMeter(0, 1, 1.2, KUANG_GATE_LOCK_TIME)).toBeCloseTo(1, 5);
    const st = createDiveState({ lanes: 12, seed: 1 });
    expect(gateZ(0)).toBeLessThan(0);
    st.phase = 'gate';
    expect(clearGate(st)).toBe('flight');
    expect(st.segment).toBe(1);
    expect(crawlerHits({ lane: 3, z: 0, alive: true }, 3, 0)).toBe(true);
    expect(crawlerHits({ lane: 3, z: 0, alive: true }, 4, 0)).toBe(false);
  });
});

describe('Kuang softs row', () => {
  it('keeps the story icebreaker in content/softs.ts', () => {
    const k = getSoft('kuang');
    expect(k?.name).toBe('KUANG GRADE MARK ELEVEN');
    expect(k?.effect.kind).toBe('kuang');
    expect(k?.unlock).toBe('m5');
    expect(SOFTS.filter((s) => s.id === 'kuang')).toHaveLength(1);
    expect(BeamFlag.KUANG).toBe(1 << 1);
  });
});
