import { describe, expect, it } from 'vitest';
import { Beam } from '../../src/render/lines/BeamBatch';
import { createPalette } from '../../src/render/palette';
import { asciiRange } from '../../src/render/text/HersheyText';
import { createVfdText, VFD_GHOST, vfdMask, vfdWidth, VfdBit } from '../../src/render/text/VfdText';

describe('VfdText', () => {
  it('ghost intensity is 6%', () => {
    expect(VFD_GHOST).toBe(0.06);
  });

  it('has a 14-seg mask for every printable ASCII character', () => {
    for (const ch of asciiRange()) {
      const m = vfdMask(ch, 14);
      expect(m).toBeGreaterThanOrEqual(0);
      if (ch === ' ') expect(m).toBe(0);
      else expect(m, ch).toBeGreaterThan(0);
    }
    expect(vfdMask('8', 14) & VfdBit.A).toBeTruthy();
    expect(vfdMask('8', 14) & VfdBit.G).toBeTruthy();
    expect(vfdMask('1', 7) & VfdBit.B).toBeTruthy();
    expect(vfdMask('a', 14)).toBe(vfdMask('A', 14));
  });

  it('setText packs masks and 7-seg flag without allocating per frame', () => {
    const batch = createVfdText(createPalette(), { capacity: 8, ghost: true });
    batch.setText('88.6', { color: Beam.AMBER, mode: 7, size: 10 });
    expect(batch.count).toBe(4);
    expect(vfdWidth('88.6', 10)).toBeCloseTo(4 * 10 * 0.86, 6);
    const data = batch.object.geometry.getAttribute('aData').array as Float32Array;
    expect(data[2]).toBe(vfdMask('8', 7));
    expect(data[3] % 2).toBe(1);
    expect(data[3]).toBeGreaterThanOrEqual(2);
    batch.dispose();
  });
});
