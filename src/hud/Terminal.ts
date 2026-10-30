import type { Mesh } from 'three';
import type { Palette } from '../render/palette';
import { Beam } from '../render/lines/BeamBatch';
import {
  createBitmapText,
  createPx437Texture,
  PX437_ATLAS,
  type BitmapText,
} from '../render/text/BitmapText';

/** 1200 baud, 8N1 → 120 characters per second (plan §6.2). */
export const TERMINAL_BAUD = 1200;
export const TERMINAL_CHARS_PER_SEC = 120;
export const TERMINAL_CURSOR_HZ = 2;

export interface TerminalPrintOpts {
  /** Wintermute hijack: the full string is visible this frame. */
  wintermute?: boolean;
}

interface QueuedLine {
  text: string;
  wintermute: boolean;
}

/**
 * Bitmap P31 terminal line. Prints at 1200 baud; Wintermute mode is instant.
 * One visible line (the deck overlay). New lines replace the previous once
 * they start printing.
 */
export interface Terminal {
  readonly object: Mesh;
  readonly visible: string;
  readonly pending: number;
  readonly printing: boolean;
  cellSize: number;
  print(text: string, opts?: TerminalPrintOpts): void;
  /** Clear queue and visible text. */
  clear(): void;
  layout(x: number, y: number, z: number, cellSize: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function createTerminal(
  palette: Palette,
  opts: { z?: number; capacity?: number } = {},
): Terminal {
  const z0 = opts.z ?? -1;
  const atlas = createPx437Texture();
  const bitmap: BitmapText = createBitmapText(palette, atlas, PX437_ATLAS, {
    capacity: opts.capacity ?? 96,
    cellSize: 14,
  });
  bitmap.material.depthTest = false;
  bitmap.object.name = 'HudTerminal';

  const queue: QueuedLine[] = [];
  let visible = '';
  let pending = '';
  let carry = 0;
  let printing = false;
  let x = 0;
  let y = 0;
  let z = z0;
  let cellSize = 14;

  const syncGpu = (time: number): void => {
    const on = (time * TERMINAL_CURSOR_HZ) % 1 < 0.5 || printing;
    const text = on ? `${visible}_` : `${visible} `;
    bitmap.setText(text, {
      x,
      y,
      z,
      cellSize,
      color: Beam.MITSU,
      intensity: 1.35,
    });
  };

  const takeNext = (): void => {
    const next = queue.shift();
    if (!next) {
      printing = false;
      pending = '';
      return;
    }
    visible = '';
    pending = next.text;
    carry = 0;
    printing = true;
    if (next.wintermute) {
      visible = pending;
      pending = '';
      printing = false;
    }
  };

  const term: Terminal = {
    object: bitmap.object,
    get visible() {
      return visible;
    },
    get pending() {
      return pending.length + queue.reduce((n, q) => n + q.text.length, 0);
    },
    get printing() {
      return printing || queue.length > 0;
    },
    get cellSize() {
      return cellSize;
    },
    set cellSize(v) {
      cellSize = Math.max(6, v);
    },
    print(text, printOpts = {}) {
      const line = text.replace(/\n/g, ' ');
      if (printOpts.wintermute) {
        queue.length = 0;
        pending = '';
        carry = 0;
        printing = false;
        visible = line;
        return;
      }
      queue.push({ text: line, wintermute: false });
    },
    clear() {
      queue.length = 0;
      visible = '';
      pending = '';
      carry = 0;
      printing = false;
    },
    layout(nx, ny, nz, size) {
      x = nx;
      y = ny;
      z = nz;
      cellSize = Math.max(6, size);
    },
    update(dt, time) {
      if (!printing && queue.length > 0) takeNext();
      if (printing && pending.length > 0) {
        carry += Math.max(0, dt) * TERMINAL_CHARS_PER_SEC;
        while (carry >= 1 && pending.length > 0) {
          visible += pending[0]!;
          pending = pending.slice(1);
          carry -= 1;
        }
        if (pending.length === 0) printing = false;
      }
      syncGpu(time);
    },
    dispose() {
      bitmap.dispose();
      atlas.dispose();
    },
  };
  return term;
}
