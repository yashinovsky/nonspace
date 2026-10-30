import { gainOf, pitchOf, playOsc, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

export function playDeckError(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts, 'ui');
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  playOsc(world, {
    type: 'square',
    freq: 220 * p,
    amp: 0.08 * g,
    attack: 0.002,
    decay: 0.12,
    when: t,
    dest,
  });
  playOsc(world, {
    type: 'square',
    freq: 165 * p,
    amp: 0.08 * g,
    attack: 0.002,
    decay: 0.16,
    when: t + 0.13,
    dest,
  });
}

export function playUiClick(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts, 'ui');
  playOsc(world, {
    type: 'sine',
    freq: 1400 * pitchOf(opts),
    amp: 0.05 * gainOf(opts),
    attack: 0.001,
    decay: 0.03,
    dest,
  });
}
