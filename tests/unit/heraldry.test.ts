import { describe, expect, it } from 'vitest';
import {
  createTempoClock,
  DEFAULT_BPM,
  pulse as tempoPulse,
} from '../../src/audio/music/Sequencer';
import {
  beamLuma,
  CORP_IDS,
  CORPS,
  corpPulse,
  isCorpId,
  ledgerBlinkMask,
  pulse,
} from '../../src/content/corps';
import {
  assertLandmarkCoords,
  corpShapeDistance,
  generateLandmark,
  getLandmark,
  hamming,
  LANDMARK_IDS,
  LANDMARKS,
  landmarkPulse,
  landmarkRhythm,
  landmarkWorldPos,
  occupancy3,
} from '../../src/content/landmarks';
import { Beam } from '../../src/render/lines/BeamBatch';
import { SECTOR_SIZE } from '../../src/world/coords';

describe('corp heraldry', () => {
  it('covers every CorpId with a unique grammar', () => {
    const grammars = new Set<string>();
    for (const id of CORP_IDS) {
      expect(isCorpId(id)).toBe(true);
      const corp = CORPS[id];
      expect(corp.id).toBe(id);
      expect(corp.hues.length).toBeGreaterThan(0);
      expect(corp.spec.kind).toBe(corp.grammar);
      grammars.add(corp.grammar);
    }
    expect(grammars.size).toBe(CORP_IDS.length);
  });

  it('pulse(t, tempo) matches the M5.3 tempo-grid hook', () => {
    const clock = createTempoClock(DEFAULT_BPM, 0);
    const beat = 60 / DEFAULT_BPM;
    expect(pulse(0, clock)).toBeCloseTo(1, 8);
    expect(pulse(beat, clock)).toBeCloseTo(1, 8);
    expect(pulse(beat / 2, clock)).toBeLessThan(0.05);
    expect(pulse(0, 96)).toBeCloseTo(tempoPulse(0, 96), 10);
    expect(pulse(beat / 2, 96)).toBeCloseTo(tempoPulse(beat / 2, 96), 10);
  });

  it('Hosaka 4/4 ticks peak on the mock tempo clock', () => {
    const clock = createTempoClock(96, 0);
    const beat = 60 / 96;
    const on = corpPulse('hosaka', 0, clock);
    const off = corpPulse('hosaka', beat / 2, clock);
    expect(on.intensity).toBeGreaterThan(off.intensity);
    expect(on.intensity).toBeGreaterThan(0.95);
    expect(off.intensity).toBeLessThan(0.85);
  });

  it('T-A breathes ±15% at 0.1 Hz', () => {
    const a = corpPulse('tessierAshpool', 0);
    const b = corpPulse('tessierAshpool', 2.5);
    expect(a.intensity).toBeCloseTo(1, 8);
    expect(b.intensity).toBeCloseTo(1.15, 8);
  });

  it('Mitsubishi ledger masks are deterministic per eighth', () => {
    const clock = createTempoClock(96, 0);
    const a = ledgerBlinkMask(4, 4, 4, 0, clock, 1);
    const b = ledgerBlinkMask(4, 4, 4, 0, clock, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
    const later = ledgerBlinkMask(4, 4, 4, 60 / 96 / 2, clock, 1);
    expect(later.length).toBe(64);
    expect(a.some((v) => v === 1)).toBe(true);
  });
});

describe('landmarks', () => {
  it('authors the M2.2 set at valid coordinates', () => {
    expect(LANDMARKS).toHaveLength(LANDMARK_IDS.length);
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARK_IDS.length);
    for (const def of LANDMARKS) {
      expect(getLandmark(def.id)).toEqual(def);
      assertLandmarkCoords(def);
      expect(def.parts.length).toBeGreaterThan(0);
      const pos = landmarkWorldPos(def.coords);
      expect(pos.x).toBeCloseTo(def.coords.x * SECTOR_SIZE, 6);
      expect(pos.y).toBe(def.coords.y);
    }
  });

  it('keeps chiba-node as the mission-fixture id', () => {
    const node = getLandmark('chiba-node');
    expect(node?.corp).toBe('minor');
    expect(node?.coords.region).toBe('CHBA');
  });

  it('Berne listens and Straylight breathes', () => {
    expect(landmarkRhythm(getLandmark('ta-berne')!)).toBe('listen');
    expect(landmarkRhythm(getLandmark('ta-straylight')!)).toBe('breathe');
    expect(getLandmark('ta-berne')!.parts).toHaveLength(2);
    expect(getLandmark('hosaka')!.parts[1]?.color).toBe(Beam.ICE);
  });

  it('generateLandmark is deterministic and far LOD is one lightpoint', () => {
    for (const id of LANDMARK_IDS) {
      const a = generateLandmark(id, { lod: 'near', seed: 4, t: 1.25 });
      const b = generateLandmark(id, { lod: 'near', seed: 4, t: 1.25 });
      expect(Array.from(a.lines.positions)).toEqual(Array.from(b.lines.positions));
      expect(a.stats.segments).toBe(b.stats.segments);
      const far = generateLandmark(id, { lod: 'far', seed: 4 });
      expect(far.stats.points).toBe(1);
      expect(far.stats.segments).toBe(0);
    }
  });

  it('landmarkPulse tracks the mock clock for Sense/Net rings', () => {
    const clock = createTempoClock(96, 0);
    const bar = (60 / 96) * 4;
    const a = landmarkPulse('sense-net', 0, clock);
    const b = landmarkPulse('sense-net', bar, clock);
    expect(a.ring).toBeCloseTo(0, 5);
    expect(b.ring).toBeCloseTo(0.5, 5);
    expect(a.yaw).not.toBe(b.yaw);
  });
});

describe('grayscale distinguishability', () => {
  it('corp shapes differ by occupancy, not hue', () => {
    const { min, ok } = corpShapeDistance(12);
    expect(ok).toBe(true);
    expect(min).toBeGreaterThanOrEqual(12);
  });

  it('landmark near-LOD silhouettes are pairwise distinct', () => {
    const occ = LANDMARK_IDS.map((id) =>
      occupancy3(generateLandmark(id, { lod: 'near', seed: 1 })),
    );
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        expect(hamming(occ[i]!, occ[j]!)).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('hue is secondary: several corps share similar luma', () => {
    const lumas = CORP_IDS.map((id) => beamLuma(CORPS[id].hues[0]!));
    expect(Math.max(...lumas) - Math.min(...lumas)).toBeGreaterThan(0.2);
  });
});
