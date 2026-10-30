import { gainOf, pitchOf, playFm, route, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Expanding ring: descending FM ping with a long delay tail. */
export function playScan(world: SfxWorld, opts?: SfxOptions): void {
  const ctx = world.ctx;
  const dest = route(world, opts);
  const t = ctx.currentTime;
  const p = pitchOf(opts);
  const g = gainOf(opts);
  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.28;
  const fb = ctx.createGain();
  fb.gain.value = 0.52;
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(dest);

  playFm(world, {
    freq: 1480 * p,
    amp: 0.14 * g,
    ratio: 3.5,
    index: 1.6,
    attack: 0.003,
    decay: 0.55,
    when: t,
    dest,
  });
  playFm(world, {
    freq: 740 * p,
    amp: 0.08 * g,
    ratio: 3.5,
    index: 1.4,
    attack: 0.003,
    decay: 0.7,
    when: t + 0.04,
    dest,
  });
  // Feed the delay from a dedicated ping so the tail is the descending ring.
  const car = ctx.createOscillator();
  const amp = ctx.createGain();
  car.frequency.setValueAtTime(1200 * p, t);
  car.frequency.exponentialRampToValueAtTime(180 * p, t + 0.9);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(0.12 * g, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  car.connect(amp).connect(delay);
  car.connect(amp).connect(dest);
  car.start(t);
  car.stop(t + 1.0);

  window.setTimeout(() => {
    try {
      car.disconnect();
      amp.disconnect();
      delay.disconnect();
      fb.disconnect();
      wet.disconnect();
    } catch {
      /* already gone */
    }
  }, 2200);
}
