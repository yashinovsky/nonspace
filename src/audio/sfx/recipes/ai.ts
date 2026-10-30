import { gainOf, pitchOf, playOsc, sfxDest, type SfxWorld } from '../synth';
import type { SfxOptions } from '../../AudioEngine';

/**
 * Wintermute hijack: freeze a short grain of the mix (delay + near-unity
 * feedback) and park a pure sine on top (plan §7.3).
 */
export function playWintermuteHijack(world: SfxWorld, opts?: SfxOptions): void {
  const ctx = world.ctx;
  const dest = sfxDest(world);
  const t = ctx.currentTime;
  const g = gainOf(opts);
  const p = pitchOf(opts);

  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.2;
  const fb = ctx.createGain();
  fb.gain.value = 0.96;
  const tap = ctx.createGain();
  tap.gain.value = 0.55;
  const out = ctx.createGain();
  out.gain.value = 0.45 * g;
  world.graph.masterDuck.connect(tap);
  tap.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(out).connect(dest);
  tap.gain.setValueAtTime(0.55, t);
  tap.gain.setValueAtTime(0, t + 0.22);

  const sine = ctx.createOscillator();
  const sg = ctx.createGain();
  sine.type = 'sine';
  sine.frequency.value = 2637 * p;
  sg.gain.setValueAtTime(0, t);
  sg.gain.linearRampToValueAtTime(0.07 * g, t + 0.04);
  sg.gain.setTargetAtTime(0.0001, t + 2.4, 0.18);
  sine.connect(sg).connect(dest);
  sine.start(t);
  sine.stop(t + 3.0);
  out.gain.setTargetAtTime(0.0001, t + 2.4, 0.2);

  world.duck('music', -18, 2.2);

  window.setTimeout(() => {
    try {
      world.graph.masterDuck.disconnect(tap);
    } catch {
      /* already gone */
    }
    try {
      tap.disconnect();
      delay.disconnect();
      fb.disconnect();
      out.disconnect();
      sine.disconnect();
      sg.disconnect();
    } catch {
      /* already gone */
    }
  }, 3200);
}

/** Reverb tail grows, tape wow, warm low-pass (plan §7.3). */
export function playNeuromancerSoften(world: SfxWorld, opts?: SfxOptions): void {
  const ctx = world.ctx;
  const dest = sfxDest(world);
  const t = ctx.currentTime;
  const g = gainOf(opts);
  const p = pitchOf(opts);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3800, t);
  lp.frequency.exponentialRampToValueAtTime(480, t + 2.4);
  lp.Q.value = 0.4;
  lp.connect(dest);

  const delays = [0.05, 0.12, 0.27];
  const taps: DelayNode[] = [];
  for (let i = 0; i < delays.length; i++) {
    const d = ctx.createDelay(1);
    d.delayTime.value = delays[i]!;
    const fb = ctx.createGain();
    fb.gain.setValueAtTime(0.25 + i * 0.08, t);
    fb.gain.linearRampToValueAtTime(0.55 + i * 0.1, t + 2.0);
    d.connect(fb).connect(d);
    d.connect(lp);
    taps.push(d);
  }

  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 196 * p;
  lfo.frequency.value = 0.7;
  lfoGain.gain.value = 4 * p;
  lfo.connect(lfoGain).connect(osc.frequency);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(0.1 * g, t + 0.4);
  amp.gain.setTargetAtTime(0.0001, t + 2.2, 0.4);
  osc.connect(amp);
  amp.connect(lp);
  for (const d of taps) amp.connect(d);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + 3.4);
  lfo.stop(t + 3.4);

  playOsc(world, {
    type: 'sine',
    freq: 98 * p,
    amp: 0.06 * g,
    attack: 0.3,
    decay: 2.6,
    when: t,
    dest: lp,
  });

  window.setTimeout(() => {
    try {
      osc.disconnect();
      amp.disconnect();
      lfo.disconnect();
      lp.disconnect();
      for (const d of taps) d.disconnect();
    } catch {
      /* already gone */
    }
  }, 3600);
}
