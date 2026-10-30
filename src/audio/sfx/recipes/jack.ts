import { degreeHz } from '../pitch';
import {
  gainOf,
  pitchOf,
  playClick,
  playFm,
  playNoise,
  playOsc,
  route,
  type SfxWorld,
} from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/**
 * Trode click / jack-in (plan §7.3, §5.9 5.5 s sequence):
 * click → rising band-passed noise sweep → phosphene sine blips → FM sus2 bloom.
 */
export function playJackIn(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playClick(world, dest, 0.55 * g, t);
  playNoise(world, {
    type: 'bandpass',
    freq: 380 * p,
    slideTo: 4200 * p,
    q: 2.4,
    amp: 0.22 * g,
    attack: 0.04,
    decay: 1.05,
    when: t,
    dest,
  });
  for (let i = 0; i < 14; i++) {
    const when = t + 0.12 + i * 0.09 + (i % 3) * 0.02;
    playOsc(world, {
      type: 'sine',
      freq: (720 + ((i * 277) % 2800)) * p,
      amp: 0.035 * g,
      attack: 0.002,
      decay: 0.07,
      when,
      dest,
    });
  }
  const { root, mode } = world.key();
  // sus2: root, 2nd, 5th
  const chord = [0, 1, 4];
  for (let i = 0; i < chord.length; i++) {
    playFm(world, {
      freq: degreeHz(root, mode, chord[i]!, 1) * p,
      amp: 0.07 * g,
      ratio: 2,
      index: 1.1,
      attack: 0.35,
      decay: 2.4,
      when: t + 0.7,
      dest,
      pan: (i - 1) * 0.35,
    });
  }
}

/** CRT collapse (jack-out, §5.9 0.6 s): descending sine "pew" + degauss thunk. */
export function playJackOut(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playOsc(world, {
    type: 'sine',
    freq: 880 * p,
    slideTo: 70 * p,
    amp: 0.22 * g,
    attack: 0.004,
    decay: 0.42,
    when: t,
    dest,
  });
  playOsc(world, {
    type: 'sine',
    freq: 90 * p,
    slideTo: 42 * p,
    amp: 0.28 * g,
    attack: 0.002,
    decay: 0.16,
    when: t + 0.28,
    dest,
  });
  playNoise(world, {
    type: 'lowpass',
    freq: 400,
    q: 0.6,
    amp: 0.2 * g,
    attack: 0.002,
    decay: 0.12,
    when: t + 0.28,
    dest,
  });
}
