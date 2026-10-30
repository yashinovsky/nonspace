import { DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { Beam } from '../../src/render/lines/BeamBatch';
import { createPalette } from '../../src/render/palette';
import { createBitmapText, PX437_ATLAS, uvForChar } from '../../src/render/text/BitmapText';
import { ASCII_END, ASCII_START, asciiRange } from '../../src/render/text/HersheyText';

const atlas = PX437_ATLAS;

describe('BitmapText / Px437', () => {
  it('atlas covers printable ASCII 32–126', () => {
    expect(atlas.cell).toBe(8);
    expect(atlas.cols).toBe(16);
    expect(atlas.count).toBe(ASCII_END - ASCII_START + 1);
    expect(atlas.first).toBe(ASCII_START);
    for (let c = ASCII_START; c <= ASCII_END; c++) {
      expect(c).toBeGreaterThanOrEqual(atlas.first);
      expect(c).toBeLessThan(atlas.first + atlas.count);
    }
  });

  it('uvForChar puts every ASCII glyph inside the atlas', () => {
    const uv = { u0: 0, v0: 0, u1: 0, v1: 0 };
    for (const ch of asciiRange()) {
      uvForChar(atlas, ch.charCodeAt(0), true, uv);
      expect(uv.u0).toBeGreaterThanOrEqual(0);
      expect(uv.v0).toBeGreaterThanOrEqual(0);
      expect(uv.u1).toBeLessThanOrEqual(1);
      expect(uv.v1).toBeLessThanOrEqual(1);
      expect(uv.u1).toBeGreaterThan(uv.u0);
      expect(uv.v1).toBeGreaterThan(uv.v0);
    }
    const a = { u0: 0, v0: 0, u1: 0, v1: 0 };
    const b = { u0: 0, v0: 0, u1: 0, v1: 0 };
    uvForChar(atlas, 32, true, a);
    uvForChar(atlas, 33, true, b);
    expect(a.u0).not.toBe(b.u0);
  });

  it('setText writes one instance per glyph and wraps on newline', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1);
    const batch = createBitmapText(createPalette(), tex, atlas, { capacity: 16 });
    batch.setText('HI\nNO', { color: Beam.GRID, cellSize: 2 });
    expect(batch.count).toBe(4);
    const origins = (batch.object.geometry.getAttribute('aOrigin').array as Float32Array).slice(
      0,
      12,
    );
    expect(origins[1]).toBe(0);
    expect(origins[7]).toBe(-2);
    batch.dispose();
    tex.dispose();
  });
});
