import { gainOf, pitchOf, playNoise, playOsc, route, sfxDest, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/** Looping "hiss of the beam" (plan §7.3: the matrix has no air). */
export interface FlightHiss {
  setSpeed(speed: number): void;
  boost(opts?: SfxOptions): void;
  speed(): number;
  dispose(): void;
}

export function createFlightHiss(world: SfxWorld): FlightHiss {
  const ctx = world.ctx;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1100;
  bp.Q.value = 0.85;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = 0;
  world.noise.connect(bp);
  bp.connect(lp).connect(g).connect(sfxDest(world, 'ambience'));
  let speed = 0;

  return {
    setSpeed(next) {
      speed = Math.max(0, next);
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(speed * 0.04, t, 0.08);
      lp.frequency.setTargetAtTime(550 + speed * 3800, t, 0.1);
      bp.frequency.setTargetAtTime(700 + speed * 1600, t, 0.1);
    },
    boost(opts) {
      const t = ctx.currentTime;
      const p = pitchOf(opts);
      const amp = gainOf(opts);
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setValueAtTime(lp.frequency.value, t);
      lp.frequency.linearRampToValueAtTime(5200, t + 0.08);
      lp.frequency.setTargetAtTime(550 + speed * 3800, t + 0.35, 0.18);
      playOsc(world, {
        type: 'sine',
        freq: 70 * p,
        slideTo: 38 * p,
        amp: 0.16 * amp,
        attack: 0.02,
        decay: 0.45,
        when: t,
        dest: sfxDest(world, 'ambience'),
      });
    },
    speed: () => speed,
    dispose() {
      try {
        world.noise.disconnect(bp);
      } catch {
        /* already gone */
      }
      g.disconnect();
    },
  };
}

/** Grid-line tick when crossing a major line — very quiet. */
export function playGridTick(world: SfxWorld, opts?: SfxOptions): void {
  const dest = route(world, opts);
  const t = world.ctx.currentTime;
  const g = gainOf(opts, 0.35);
  playOsc(world, {
    type: 'sine',
    freq: 2100 * pitchOf(opts),
    amp: 0.03 * g,
    attack: 0.001,
    decay: 0.025,
    when: t,
    dest,
  });
  playNoise(world, {
    type: 'highpass',
    freq: 4000,
    q: 0.5,
    amp: 0.02 * g,
    attack: 0.001,
    decay: 0.02,
    when: t,
    dest,
  });
}

export function playBoost(world: SfxWorld, hiss: FlightHiss | null, opts?: SfxOptions): void {
  hiss?.boost(opts);
  if (!hiss) {
    const dest = route(world, opts, 'ambience');
    playOsc(world, {
      type: 'sine',
      freq: 70 * pitchOf(opts),
      slideTo: 38 * pitchOf(opts),
      amp: 0.16 * gainOf(opts),
      attack: 0.02,
      decay: 0.45,
      dest,
    });
    playNoise(world, {
      type: 'lowpass',
      freq: 400,
      slideTo: 2800,
      q: 0.5,
      amp: 0.1 * gainOf(opts),
      attack: 0.02,
      decay: 0.35,
      dest,
    });
  }
}
