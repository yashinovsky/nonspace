import { gainOf, pitchOf, playNoise, playOsc, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';
import { playJackOut } from './jack';

/** Telephone-exchange relay click. */
export function playTraceTick(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts, 'ui');
  const t = world.ctx.currentTime;
  const g = gainOf(opts, 0.6);
  playNoise(world, {
    type: 'bandpass',
    freq: 2400 * pitchOf(opts),
    q: 4,
    amp: 0.12 * g,
    attack: 0.001,
    decay: 0.018,
    when: t,
    dest,
  });
  playNoise(world, {
    type: 'bandpass',
    freq: 1800 * pitchOf(opts),
    q: 3,
    amp: 0.08 * g,
    attack: 0.001,
    decay: 0.012,
    when: t + 0.012,
    dest,
  });
}

/** Off-hook howler (brief), then forced jack-out collapse. */
export function playBurned(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  // ITU-ish howler: dual tone around 1400 / 2060 Hz.
  playOsc(world, {
    type: 'sine',
    freq: 1400 * p,
    amp: 0.12 * g,
    attack: 0.01,
    decay: 0.55,
    when: t,
    dest,
  });
  playOsc(world, {
    type: 'sine',
    freq: 2060 * p,
    amp: 0.1 * g,
    attack: 0.01,
    decay: 0.55,
    when: t,
    dest,
  });
  window.setTimeout(() => playJackOut(world, opts), 560);
}
