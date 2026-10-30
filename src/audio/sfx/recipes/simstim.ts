import { gainOf, pitchOf, playClick, playNoise, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Channel-change click + 200 ms of shaped static (plan §7.3 / §5.9 0.3 s). */
export function playSimstimFlip(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const g = gainOf(opts);
  playClick(world, dest, 0.4 * g, t);
  playNoise(world, {
    type: 'bandpass',
    freq: 1800 * pitchOf(opts),
    q: 0.8,
    amp: 0.16 * g,
    attack: 0.008,
    decay: 0.2,
    when: t + 0.02,
    dest,
  });
  playNoise(world, {
    type: 'highpass',
    freq: 4000,
    q: 0.5,
    amp: 0.08 * g,
    attack: 0.004,
    decay: 0.14,
    when: t + 0.04,
    dest,
  });
}
