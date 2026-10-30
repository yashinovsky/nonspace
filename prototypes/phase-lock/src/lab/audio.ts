/**
 * Simple Web Audio for the lab (plan §7). No engine: plain oscillators into a stereo merger.
 * The two figures are heard the way an oscilloscope sees them: x drives the left channel, y the right.
 *   ICE:     left a·f0, right b·f0 (sine)
 *   Breaker: left a·f0, right R·a·f0 (triangle)
 * So a ratio mismatch beats on the right at |R·a − b|·f0 Hz, and a match is a clean interval
 * (3:2 a fifth, 4:3 a fourth). Phase alignment is heard as constructive interference on the left.
 */
const F0 = 110; // A2: the mission key for the lab
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, (2 * 9) / 8, (2 * 5) / 4, (2 * 3) / 2, (2 * 5) / 3];

export class LabAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bed!: GainNode;
  private iceL!: OscillatorNode;
  private iceR!: OscillatorNode;
  private brkL!: OscillatorNode;
  private brkR!: OscillatorNode;
  private gIceL!: GainNode;
  private gIceR!: GainNode;
  private gBrkL!: GainNode;
  private gBrkR!: GainNode;
  private growl: { osc: OscillatorNode; mod: OscillatorNode; gain: GainNode } | null = null;
  private heartTimer = 0;
  private tickTimer = 0;
  private noise!: AudioBuffer;
  muted = false;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (autoplay policy). */
  unlock(): void {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(limiter).connect(ctx.destination);
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(this.master);

    const merger = ctx.createChannelMerger(2);
    merger.connect(this.bed);
    const mk = (type: OscillatorType, ch: 0 | 1, level: number): [OscillatorNode, GainNode] => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = F0;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(merger, 0, ch);
      o.start();
      return [o, g];
    };
    [this.iceL, this.gIceL] = mk('sine', 0, 0.12);
    [this.iceR, this.gIceR] = mk('sine', 1, 0.12);
    [this.brkL, this.gBrkL] = mk('triangle', 0, 0.09);
    [this.brkR, this.gBrkR] = mk('triangle', 1, 0.09);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Per-frame update of the tone bed. `cons` is phase consonance 0..1. */
  update(p: {
    engaged: boolean;
    a: number;
    b: number;
    R: number;
    cons: number;
    m: number;
    slide: { a: number; b: number; k: number } | null;
    trace: number;
    dt: number;
    grip: boolean;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bed.gain.setTargetAtTime(p.engaged ? (p.grip ? 0.45 : 1) : 0, t, 0.08);
    if (!p.engaged) return;
    let ia = p.a;
    let ib = p.b;
    if (p.slide) {
      ia = p.a + (p.slide.a - p.a) * p.slide.k;
      ib = p.b + (p.slide.b - p.b) * p.slide.k;
    }
    this.iceL.frequency.setTargetAtTime(ia * F0, t, 0.02);
    this.iceR.frequency.setTargetAtTime(ib * F0, t, 0.02);
    this.brkL.frequency.setTargetAtTime(p.a * F0, t, 0.02);
    this.brkR.frequency.setTargetAtTime(Math.min(4000, p.R * p.a * F0), t, 0.01);
    this.gIceL.gain.setTargetAtTime(0.06 + 0.08 * p.cons, t, 0.03);
    this.gIceR.gain.setTargetAtTime(p.slide ? 0.09 : 0.12, t, 0.03);
    this.gBrkL.gain.setTargetAtTime(0.04 + 0.07 * p.cons, t, 0.03);
    this.gBrkR.gain.setTargetAtTime(0.07 + 0.04 * p.m, t, 0.03);

    // Trace = a call being traced back: relay clicks, faster as trace rises.
    this.tickTimer -= p.dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = 1.6 - 1.4 * Math.min(1, p.trace / 100);
      this.click(0.04 + 0.05 * (p.trace / 100));
    }
    if (this.growl) {
      this.heartTimer -= p.dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.62;
        this.thump(t, 0.5);
        this.thump(t + 0.18, 0.35);
      }
    }
  }

  private env(t: number, g: GainNode, peak: number, a: number, d: number): void {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, t: number, dur: number, peak: number, type: OscillatorType = 'sine', pan = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    this.env(t, g, peak, 0.005, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two-operator FM "tink". */
  private fm(freq: number, t: number, dur: number, peak: number, pan = 0): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.5;
    mg.gain.setValueAtTime(freq * 2.5, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    car.connect(g).connect(p).connect(this.master);
    this.env(t, g, peak, 0.002, dur);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private click(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 4;
    const g = ctx.createGain();
    src.connect(bp).connect(g).connect(this.master);
    this.env(t, g, level, 0.001, 0.025);
    src.start(t, Math.random() * 0.5, 0.05);
  }

  private thump(t: number, level: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    this.env(t, g, level, 0.004, 0.18);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Re-key telegraph: soft alarm double-beep (the tone slide is driven through `update`). */
  telegraph(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1320, t, 0.07, 0.07, 'square');
    this.tone(1320, t + 0.13, 0.07, 0.07, 'square');
  }

  rekey(): void {
    if (!this.ctx) return;
    this.fm(F0 * 4, this.ctx.currentTime, 0.25, 0.08);
  }

  /** Lock meter: rising arpeggio steps per 10%. */
  lockStep(step: number): void {
    if (!this.ctx) return;
    this.fm(F0 * 4 * PENTA[Math.min(PENTA.length - 1, step)], this.ctx.currentTime, 0.18, 0.06, step % 2 ? 0.3 : -0.3);
  }

  /** Shatter: many short FM tinks in key, falling, then the tone resolves to a chord. */
  shatter(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 14; i++) {
      const f = F0 * 8 * PENTA[(Math.random() * PENTA.length) | 0] * Math.pow(0.93, i);
      this.fm(f, t + i * 0.045 + Math.random() * 0.02, 0.22, 0.05, Math.random() * 2 - 1);
    }
    for (const r of [1, 3 / 2, 2, 5 / 2]) this.tone(F0 * 2 * r, t + 0.05, 1.6, 0.05, 'sine');
  }

  gripStart(): void {
    const ctx = this.ctx;
    if (!ctx || this.growl) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 41;
    const mod = ctx.createOscillator();
    mod.frequency.value = 29;
    const ring = ctx.createGain();
    ring.gain.value = 0;
    mod.connect(ring.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.4);
    osc.connect(ring).connect(lp).connect(gain).connect(this.master);
    osc.start();
    mod.start();
    this.growl = { osc, mod, gain };
    this.heartTimer = 0;
  }

  gripEnd(): void {
    const g = this.growl;
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.gain.setTargetAtTime(0, t, 0.08);
    g.osc.stop(t + 0.5);
    g.mod.stop(t + 0.5);
    this.growl = null;
  }

  /** Flatline: continuous 1 kHz monitor tone, then hard silence. */
  flatline(): void {
    if (!this.ctx) return;
    this.gripEnd();
    const t = this.ctx.currentTime;
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setValueAtTime(0, t);
    const o = this.ctx.createOscillator();
    o.frequency.value = 1000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.setValueAtTime(0.09, t + 2.2);
    g.gain.linearRampToValueAtTime(0, t + 2.21);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.3);
  }

  /** Burned: brief off-hook howler. */
  burned(): void {
    if (!this.ctx) return;
    this.gripEnd();
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.tone(1400 + (i % 2) * 650, t + i * 0.12, 0.1, 0.05, 'square');
    }
  }
}
