import { degreeHz } from '../pitch';
import { gainOf, pitchOf, playFm, playOsc, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Dissonant FM buzz; `opts.pitch` stands in for corp fundamental. */
export function playHullContact(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playFm(world, {
    freq: 85 * p,
    amp: 0.18 * g,
    ratio: 1.414,
    index: 4.2,
    attack: 0.004,
    decay: 0.28,
    when: t,
    dest,
  });
  playFm(world, {
    freq: 128 * p,
    amp: 0.1 * g,
    ratio: 2.7,
    index: 3.1,
    attack: 0.004,
    decay: 0.22,
    when: t,
    dest,
    pan: 0.4,
  });
}

/** Rising arpeggio step (call once per 10% lock). Catalog tracks the degree. */
export function playLockStep(world: SfxWorld, step: number, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const { root, mode } = world.key();
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playFm(world, {
    freq: degreeHz(root, mode, step, 2) * p,
    amp: 0.09 * g,
    ratio: 2,
    index: 1.3,
    attack: 0.004,
    decay: 0.18,
    dest,
  });
}

/** Pitch-slide of ICE-like tones + a soft alarm double-beep. */
export function playRekeyTelegraph(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playOsc(world, {
    type: 'sine',
    freq: 220 * p,
    slideTo: 330 * p,
    amp: 0.1 * g,
    attack: 0.02,
    decay: 0.35,
    when: t,
    dest,
  });
  playOsc(world, {
    type: 'sine',
    freq: 330 * p,
    slideTo: 495 * p,
    amp: 0.1 * g,
    attack: 0.02,
    decay: 0.35,
    when: t,
    dest,
  });
  playOsc(world, {
    type: 'square',
    freq: 880 * p,
    amp: 0.06 * g,
    attack: 0.002,
    decay: 0.07,
    when: t + 0.12,
    dest,
  });
  playOsc(world, {
    type: 'square',
    freq: 880 * p,
    amp: 0.06 * g,
    attack: 0.002,
    decay: 0.07,
    when: t + 0.22,
    dest,
  });
}

/** Many short FM tinks, randomized pitch in key, falling. */
export function playShatter(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  const { root, mode } = world.key();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const degree = (i * 3 + 1) % 14;
    playFm(world, {
      freq: degreeHz(root, mode, degree, 2 - Math.floor(i / 5)) * p,
      amp: (0.07 - i * 0.003) * g,
      ratio: 3.5,
      index: 2.4,
      attack: 0.002,
      decay: 0.09 + i * 0.012,
      when: t + i * 0.028 + (i % 2) * 0.01,
      dest,
      pan: ((i % 5) - 2) * 0.28,
    });
  }
}
