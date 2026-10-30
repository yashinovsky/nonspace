import type { Object3D } from 'three';
import type { Palette } from '../render/palette';
import { Beam, BeamFlag, createBeamBatch } from '../render/lines/BeamBatch';
import { createVfdText, type VfdText } from '../render/text/VfdText';

export interface SoftSlot {
  /** Cartridge label, e.g. `PROBE`, or `--` when empty. */
  label: string;
  /** 0 = ready, 1 = just fired (segment wipe remaining). */
  cooldown: number;
}

export interface VfdStripState {
  coords: string;
  mode: string;
  speed: number;
  neural: number;
  softs: readonly SoftSlot[];
  /** Seconds left on black-ICE grip; `null` hides the countdown. */
  gripRemaining?: number | null;
}

export interface VfdStripLayout {
  eegLabel: { x: number; y: number };
  neural: { x: number; y: number };
  coords: { x: number; y: number };
  mode: { x: number; y: number };
  speed: { x: number; y: number };
  traceLabel: { x: number; y: number };
  softs: { x: number; y: number };
  size: number;
  z: number;
}

const EMPTY_SOFT: SoftSlot = { label: '--', cooldown: 0 };

const _a = { x: 0, y: 0, z: -1 };
const _b = { x: 0, y: 0, z: -1 };

export function padHud3(n: number): string {
  const v = Math.max(0, Math.min(999, Math.round(n)));
  return v.toString().padStart(3, '0');
}

export interface VfdStrip {
  readonly objects: readonly Object3D[];
  layout(next: VfdStripLayout): void;
  update(state: VfdStripState): void;
  dispose(): void;
}

function makeVfd(palette: Palette, capacity: number, size: number): VfdText {
  const v = createVfdText(palette, { capacity, ghost: true, size });
  v.material.depthTest = false;
  v.object.name = 'HudVfd';
  return v;
}

export function createVfdStrip(palette: Palette, opts: { z?: number } = {}): VfdStrip {
  const eeg = makeVfd(palette, 8, 12);
  const neural = makeVfd(palette, 16, 12);
  const coords = makeVfd(palette, 40, 12);
  const mode = makeVfd(palette, 24, 12);
  const speed = makeVfd(palette, 12, 12);
  const trace = makeVfd(palette, 8, 12);
  const softs = makeVfd(palette, 48, 12);
  const wipe = createBeamBatch(palette, {
    capacity: 8,
    style: { fogDensity: 0, fogStart: 1e9, sigma: 0.5, dwell: 0 },
  });
  wipe.object.name = 'HudSoftWipe';
  wipe.material.depthTest = false;

  const pos: VfdStripLayout = {
    eegLabel: { x: 0, y: 0 },
    neural: { x: 0, y: 0 },
    coords: { x: 0, y: 0 },
    mode: { x: 0, y: 0 },
    speed: { x: 0, y: 0 },
    traceLabel: { x: 0, y: 0 },
    softs: { x: 0, y: 0 },
    size: 12,
    z: opts.z ?? -1,
  };

  const write = (
    batch: VfdText,
    text: string,
    at: { x: number; y: number },
    extra: { color?: Beam; intensity?: number; mode?: 7 | 14; size?: number } = {},
  ): void => {
    batch.setText(text, {
      x: at.x,
      y: at.y,
      z: pos.z,
      size: extra.size ?? pos.size,
      color: extra.color ?? Beam.GRID,
      intensity: extra.intensity ?? 1,
      mode: extra.mode ?? 14,
    });
  };

  return {
    objects: [
      eeg.object,
      neural.object,
      coords.object,
      mode.object,
      speed.object,
      trace.object,
      softs.object,
      wipe.object,
    ],
    layout(next) {
      pos.eegLabel = next.eegLabel;
      pos.neural = next.neural;
      pos.coords = next.coords;
      pos.mode = next.mode;
      pos.speed = next.speed;
      pos.traceLabel = next.traceLabel;
      pos.softs = next.softs;
      pos.size = next.size;
      pos.z = next.z;
      write(eeg, 'EEG', pos.eegLabel, { intensity: 0.9 });
      write(trace, 'TRACE', pos.traceLabel, { intensity: 0.9 });
    },
    update(state) {
      write(neural, `NEURAL ${padHud3(state.neural)}`, pos.neural, {
        color: Beam.AMBER,
        intensity: 1.05,
      });
      write(coords, state.coords, pos.coords, { intensity: 1.15 });
      const gripping = state.gripRemaining != null;
      write(mode, gripping ? 'MODE GRIP' : `MODE ${state.mode}`, pos.mode, {
        color: gripping ? Beam.ESFA : Beam.AMBER,
        intensity: 1.05,
      });
      if (gripping) {
        const g = Math.max(0, state.gripRemaining ?? 0);
        write(speed, g.toFixed(1).padStart(3, '0'), pos.speed, {
          color: Beam.ESFA,
          intensity: 1.35,
          mode: 7,
          size: pos.size * 1.15,
        });
      } else {
        write(speed, `SPD ${padHud3(state.speed)}`, pos.speed, {
          color: Beam.AMBER,
          intensity: 1.2,
          mode: 7,
          size: pos.size * 1.05,
        });
      }
      const slots = [0, 1, 2, 3].map((i) => state.softs[i] ?? EMPTY_SOFT);
      const parts = slots.map((s, i) => `${i + 1}:${s.label.toUpperCase()}`);
      write(softs, parts.join(' '), pos.softs, { intensity: 0.95, size: pos.size * 0.92 });

      const adv = pos.size * 0.92 * 0.86;
      const z = pos.z;
      wipe.beginDynamic();
      let cursor = 0;
      for (let i = 0; i < 4; i++) {
        const label = parts[i]!;
        const slot = slots[i]!;
        const width = label.length * adv;
        if (slot.cooldown > 0.02) {
          const frac = Math.min(1, Math.max(0, slot.cooldown));
          _a.x = pos.softs.x + cursor;
          _a.y = pos.softs.y - pos.size * 0.22;
          _a.z = z;
          _b.x = _a.x + width * frac;
          _b.y = _a.y;
          _b.z = z;
          wipe.push(_a, _b, Beam.AFTERGLOW, 0.9, 1.4, BeamFlag.NO_FOG);
        }
        cursor += width + adv;
      }
      wipe.endDynamic();
    },
    dispose() {
      eeg.dispose();
      neural.dispose();
      coords.dispose();
      mode.dispose();
      speed.dispose();
      trace.dispose();
      softs.dispose();
      wipe.dispose();
    },
  };
}
