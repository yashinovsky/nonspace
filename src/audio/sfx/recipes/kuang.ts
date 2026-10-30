import { degreeHz } from '../pitch';
import { gainOf, pitchOf, playFm, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Shimmering chorus of detuned FM. */
export function playKuang(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  const { root, mode } = world.key();
  const base = degreeHz(root, mode, 4, 2) * p;
  const detune = [1, 1.007, 0.993, 1.014, 0.986];
  for (let i = 0; i < detune.length; i++) {
    playFm(world, {
      freq: base * detune[i]!,
      amp: 0.055 * g,
      ratio: 2.01 + i * 0.03,
      index: 2.8,
      attack: 0.08,
      decay: 1.4,
      when: t + i * 0.03,
      dest,
      pan: (i - 2) * 0.25,
    });
  }
}

/** Sting stab when Kuang strikes. */
export function playKuangSting(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  const { root, mode } = world.key();
  playFm(world, {
    freq: degreeHz(root, mode, 0, 3) * p,
    amp: 0.2 * g,
    ratio: 1.5,
    index: 5,
    attack: 0.002,
    decay: 0.35,
    when: t,
    dest,
  });
  playFm(world, {
    freq: degreeHz(root, mode, 4, 2) * p,
    amp: 0.12 * g,
    ratio: 3,
    index: 3.2,
    attack: 0.002,
    decay: 0.28,
    when: t,
    dest,
    pan: -0.3,
  });
  playFm(world, {
    freq: degreeHz(root, mode, 0, 1) * p,
    amp: 0.14 * g,
    ratio: 2,
    index: 2,
    attack: 0.003,
    decay: 0.5,
    when: t,
    dest,
    pan: 0.3,
  });
}
