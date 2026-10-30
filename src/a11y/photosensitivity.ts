/**
 * M8.1 photosensitivity audit (plan §5.9 / §8.10). Frame-steps CPU luma
 * twins of every authored sequence at 60 Hz. Large-area flashes stay ≤ 3/s.
 *
 * GPU capture is a sibling e2e concern; this module is the MUST script/check.
 */

import { TRACE_BLINK_FROM, traceBlink } from '../hud/Bargraph';
import { MERGE_DURATION, mergeSample } from '../campaign/merge';
import { TELETEXT_FLASH_HZ, flashOn } from '../meat/Teletext';
import { CRT_COLLAPSE_DURATION, sampleCrtCollapseLuma } from '../render/fx/CrtCollapse';
import { JACK_IN_FULL, JACK_IN_SHORT, sampleJackInLuma } from '../render/fx/JackInSequence';
import { sampleJumpStreak } from '../render/fx/JumpStreak';
import { TELEGRAPH_FLICKER_HZ, telegraphFlicker } from '../render/faces/iceFacetMath';
import { RASTER_TRANSITION_DURATION, sampleTransitionLuma } from '../render/post/rasterCrt';

export const FLASH_FPS = 60;
/** Plan §5.9: no more than 3 general flashes per second. */
export const MAX_FLASHES_PER_SEC = 3;
/** Rising-edge luma delta that counts as a large-area flash. */
export const FLASH_THRESHOLD = 0.12;

export interface SequenceAudit {
  id: string;
  duration: number;
  samples: number[];
  flashes: number;
  flashesPerSec: number;
  peak: number;
}

export function countFlashes(samples: readonly number[], threshold = FLASH_THRESHOLD): number {
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

export function sampleAtFps(duration: number, fps: number, at: (t: number) => number): number[] {
  const n = Math.max(1, Math.round(duration * fps));
  const dt = 1 / fps;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(at(i * dt));
  return out;
}

function audit(id: string, duration: number, samples: number[]): SequenceAudit {
  const flashes = countFlashes(samples);
  return {
    id,
    duration,
    samples,
    flashes,
    flashesPerSec: duration > 0 ? flashes / duration : flashes,
    peak: samples.reduce((m, v) => (v > m ? v : m), 0),
  };
}

function jumpLuma(t: number, duration: number, reduceMotion: boolean): number {
  const u = duration > 0 ? Math.min(1, t / duration) : 0;
  return sampleJumpStreak('streak', u, reduceMotion).streak * (reduceMotion ? 0.08 : 0.18);
}

function telegraphLuma(t: number, reduceFlashing: boolean): number {
  const amount = reduceFlashing ? 0.22 : 0.85;
  return telegraphFlicker(t, amount, reduceFlashing) * 0.2;
}

function teletextLuma(t: number, reduceFlashing: boolean): number {
  return flashOn(t, reduceFlashing) ? 0.08 : 0.02;
}

function bargraphLuma(t: number, reduceFlashing: boolean): number {
  return 0.05 + 0.07 * traceBlink(TRACE_BLINK_FROM + 0.05, t, reduceFlashing);
}

function titlePromptLuma(t: number, reduceFlashing: boolean): number {
  if (reduceFlashing) return 0.06;
  return Math.floor(t / 0.6) % 2 === 0 ? 0.08 : 0.02;
}

function mergeLuma(t: number, reduceFlashing: boolean): number {
  return mergeSample(t, reduceFlashing).lerpWhite * 0.22;
}

/** Every authored flashy sequence. `reduceFlashing` is the first-boot default. */
export function auditSequences(reduceFlashing = true, reduceMotion = false): SequenceAudit[] {
  const jumpDur = 2;
  return [
    audit('jack-in-full', JACK_IN_FULL, sampleJackInLuma(JACK_IN_FULL, FLASH_FPS, reduceFlashing)),
    audit(
      'jack-in-short',
      JACK_IN_SHORT,
      sampleJackInLuma(JACK_IN_SHORT, FLASH_FPS, reduceFlashing),
    ),
    audit(
      'jack-out',
      CRT_COLLAPSE_DURATION,
      sampleCrtCollapseLuma(CRT_COLLAPSE_DURATION, FLASH_FPS),
    ),
    audit(
      'simstim-flip',
      RASTER_TRANSITION_DURATION,
      sampleTransitionLuma(RASTER_TRANSITION_DURATION, FLASH_FPS, reduceFlashing),
    ),
    audit(
      'jump-streak',
      jumpDur,
      sampleAtFps(jumpDur, FLASH_FPS, (t) => jumpLuma(t, jumpDur, reduceMotion)),
    ),
    audit(
      'ice-telegraph',
      2,
      sampleAtFps(2, FLASH_FPS, (t) => telegraphLuma(t, reduceFlashing)),
    ),
    audit(
      'teletext-flash',
      2 / TELETEXT_FLASH_HZ,
      sampleAtFps(2 / TELETEXT_FLASH_HZ, FLASH_FPS, (t) => teletextLuma(t, reduceFlashing)),
    ),
    audit(
      'trace-bargraph',
      2,
      sampleAtFps(2, FLASH_FPS, (t) => bargraphLuma(t, reduceFlashing)),
    ),
    audit(
      'title-prompt',
      2.4,
      sampleAtFps(2.4, FLASH_FPS, (t) => titlePromptLuma(t, reduceFlashing)),
    ),
    audit(
      'merge',
      MERGE_DURATION,
      sampleAtFps(MERGE_DURATION, FLASH_FPS, (t) => mergeLuma(t, reduceFlashing)),
    ),
  ];
}

export function assertFlashRule(rows: readonly SequenceAudit[]): SequenceAudit[] {
  const failed: SequenceAudit[] = [];
  for (const row of rows) {
    if (row.flashesPerSec > MAX_FLASHES_PER_SEC + 1e-9) failed.push(row);
  }
  return failed;
}

export { TELEGRAPH_FLICKER_HZ };
