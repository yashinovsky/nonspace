import { degreeHz } from '../pitch';
import { gainOf, pitchOf, playFm, playNoise, playOsc, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Coordinate jump: pitch-rising sine + noise riser. */
export function playJump(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playOsc(world, {
    type: 'sine',
    freq: 180 * p,
    slideTo: 1400 * p,
    amp: 0.16 * g,
    attack: 0.02,
    decay: 0.55,
    when: t,
    dest,
  });
  playNoise(world, {
    type: 'bandpass',
    freq: 300 * p,
    slideTo: 3600 * p,
    q: 1.8,
    amp: 0.14 * g,
    attack: 0.05,
    decay: 0.5,
    when: t,
    dest,
  });
}

/** Soft arrival chord (root, 5th, octave). */
export function playJumpArrive(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  const { root, mode } = world.key();
  const degrees = [0, 4, 7];
  for (let i = 0; i < degrees.length; i++) {
    playFm(world, {
      freq: degreeHz(root, mode, degrees[i]!, 1) * p,
      amp: 0.08 * g,
      ratio: 2,
      index: 0.9,
      attack: 0.04,
      decay: 0.7,
      when: t,
      dest,
      pan: (i - 1) * 0.3,
    });
  }
}
