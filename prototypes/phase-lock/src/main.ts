import { LayerSim } from './breach/LayerSim';
import { SCOPE_HZ, TAU, clampLnR, knobToR, phaseError, sampleBreaker, sampleTarget, wrapPositive } from './breach/PhaseLock';
import { DIFFICULTIES, ICE_PRESETS, type TuningId, applyDifficulty, getDifficulty, getIce } from './breach/presets';
import { Rng } from './breach/rng';
import { BOT_PROFILES, HumanProxy } from './bot/HumanProxy';
import { LabAudio } from './lab/audio';
import { BEAM, SPECIAL } from './lab/palette';
import { type FrameView, Renderer, type Shard, type Tendril } from './lab/render';

const DT = 1 / 120;
const STORE_KEY = 'nonspace.phaselock.tries.v1';
const qs = new URLSearchParams(location.search);

interface TryRec {
  ice: string;
  diff: string;
  tuning?: TuningId;
  time: number;
  status: string;
  auto: boolean;
}

type Phase = FrameView['phase'];

class Lab {
  iceId: string = getIce(qs.get('ice') ?? 'gray-3').id;
  diffId: string = getDifficulty(qs.get('diff') ?? 'normal').id;
  tuning: TuningId = qs.get('tuning') === 'proposed' ? 'proposed' : 'plan';
  bot = qs.get('bot') === '1';
  ghost = qs.get('ghost') !== '0';
  purist = qs.get('purist') === '1';
  reduceFlash = qs.get('calm') === '1';
  u = Math.log(1.0);
  Phi = 0;
  phase: Phase = qs.get('skipTitle') === '1' ? 'ready' : 'title';
  phaseT = 0;
  time = 0;
  theta = 0;
  layerNo = 1;
  sim: LayerSim | null = null;
  proxy: HumanProxy | null = null;
  shards: Shard[] = [];
  tendrils: Tendril[] = [];
  down: 'flatline' | 'burned' | null = null;
  lastTime: number | null = null;
  eeg = new Float32Array(240);
  eegHead = 0;
  tries: TryRec[] = load();
  private seedRng = new Rng(Number(qs.get('seed') ?? Date.now() % 1e9));
  private acc = 0;
  private keys = new Set<string>();
  private shift = false;

  readonly audio = new LabAudio();
  readonly renderer: Renderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.bindInput(canvas);
    if (this.bot && this.phase === 'ready') this.engage();
  }

  get ice() {
    return getIce(this.iceId, this.tuning);
  }
  get diff() {
    return getDifficulty(this.diffId, this.tuning);
  }
  get R(): number {
    return knobToR(this.u, this.purist);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const anyGesture = () => {
      this.audio.unlock();
      if (this.phase === 'title') this.setPhase('ready');
    };
    addEventListener('keydown', (e) => {
      anyGesture();
      this.shift = e.shiftKey;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (e.repeat) return;
      const iceIdx = ['1', '2', '3', '4'].indexOf(k);
      if (iceIdx >= 0) this.select(ICE_PRESETS[iceIdx].id, this.diffId);
      else if (k === 'z' || k === 'x' || k === 'c') this.select(this.iceId, DIFFICULTIES['zxc'.indexOf(k)].id);
      else if (k === 'b') {
        this.bot = !this.bot;
        this.proxy = null;
        if (this.bot && this.phase === 'ready') this.engage();
      } else if (k === 't') {
        this.tuning = this.tuning === 'plan' ? 'proposed' : 'plan';
        this.select(this.iceId, this.diffId);
      } else if (k === 'g') this.ghost = !this.ghost;
      else if (k === 'p') this.purist = !this.purist;
      else if (k === 'f') this.reduceFlash = !this.reduceFlash;
      else if (k === 'm') this.audio.setMuted(!this.audio.muted);
      else if (k === ' ' || k === 'enter') {
        if (this.phase === 'ready') this.engage();
        else if (this.phase === 'down' && this.phaseT > 0.6) this.setPhase('ready');
      } else if (k === 'delete') {
        this.tries = [];
        save(this.tries);
      }
    });
    addEventListener('keyup', (e) => {
      this.shift = e.shiftKey;
      this.keys.delete(e.key.toLowerCase());
    });
    canvas.addEventListener('mousedown', () => {
      const wasTitle = this.phase === 'title';
      anyGesture();
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
      if (!wasTitle && this.phase === 'ready') this.engage();
    });
    addEventListener('mousemove', (e) => {
      if (this.bot && this.phase === 'engaged') return;
      this.shift = e.shiftKey;
      const fine = e.shiftKey ? 0.15 : 1;
      this.u = clampLnR(this.u + e.movementX * 0.0022 * fine);
      this.Phi = wrapPositive(this.Phi - e.movementY * 0.008 * fine);
    });
  }

  private select(iceId: string, diffId: string): void {
    this.iceId = iceId;
    this.diffId = diffId;
    this.sim = null;
    this.proxy = null;
    this.audio.gripEnd();
    this.layerNo = 1;
    this.setPhase('ready');
    if (this.bot) this.engage();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'ready') {
      this.down = null;
      this.shards = [];
    }
  }

  engage(): void {
    const def = applyDifficulty(this.ice.layer, this.diff);
    const seed = (this.seedRng.next() * 2 ** 31) | 0;
    this.sim = new LayerSim(def, seed);
    this.proxy = this.bot ? new HumanProxy({ ...BOT_PROFILES.average, useTelegraph: this.ghost }, def.ratios, seed ^ 0x2545f491, { u: this.u, Phi: this.Phi }) : null;
    if (this.proxy) this.proxy.purist = this.purist;
    this.tendrils = [];
    this.setPhase('engaged');
  }

  private record(status: string): void {
    const s = this.sim!.state;
    this.tries.push({ ice: this.iceId, diff: this.diffId, tuning: this.tuning, time: +s.t.toFixed(2), status, auto: this.bot });
    save(this.tries);
    this.lastTime = s.t;
  }

  update(dt: number): void {
    this.time += dt;
    this.phaseT += dt;
    this.theta += TAU * SCOPE_HZ * dt;

    if (!(this.bot && this.phase === 'engaged')) {
      const fine = this.shift ? 0.12 : 1;
      if (this.keys.has('arrowleft')) this.u = clampLnR(this.u - 0.5 * fine * dt);
      if (this.keys.has('arrowright')) this.u = clampLnR(this.u + 0.5 * fine * dt);
      if (this.keys.has('arrowup')) this.Phi = wrapPositive(this.Phi + 2.2 * fine * dt);
      if (this.keys.has('arrowdown')) this.Phi = wrapPositive(this.Phi - 2.2 * fine * dt);
    }

    if (this.phase === 'engaged' && this.sim) {
      this.acc += dt;
      while (this.acc >= DT && this.phase === 'engaged') {
        this.acc -= DT;
        if (this.proxy) {
          this.proxy.step(DT, this.sim);
          this.u = this.proxy.u;
          this.Phi = this.proxy.Phi;
        }
        for (const e of this.sim.step(DT, this.R, this.Phi)) this.onEvent(e.type, e);
      }
    } else {
      this.acc = 0;
    }

    if (this.phase === 'shatter' && this.phaseT >= 1.8) {
      this.layerNo++;
      this.setPhase('ready');
      this.engage();
    }
    if (this.phase === 'down' && this.bot && this.phaseT > 3.2) {
      this.setPhase('ready');
      this.engage();
    }

    this.pushEeg(dt);
    this.updateAudio(dt);
  }

  private onEvent(type: string, e: unknown): void {
    const s = this.sim!.state;
    switch (type) {
      case 'telegraph':
        this.audio.telegraph();
        break;
      case 'rekey':
        this.audio.rekey();
        break;
      case 'lockStep':
        this.audio.lockStep((e as { step: number }).step);
        break;
      case 'grip': {
        this.audio.gripStart();
        const rng = new Rng((s.t * 1000) | 0);
        this.tendrils = Array.from({ length: 11 }, (_, i) => {
          const side = i % 4;
          const t = rng.next();
          return {
            sx: side === 0 ? 0 : side === 1 ? 1 : t,
            sy: side === 2 ? 0 : side === 3 ? 1 : t,
            wobble: Array.from({ length: 14 }, () => rng.range(-1, 1)),
          };
        });
        break;
      }
      case 'crack':
        this.record('cracked');
        this.audio.gripEnd();
        this.audio.shatter();
        this.makeShards();
        this.setPhase('shatter');
        break;
      case 'flatline':
      case 'burned':
        this.record(type);
        this.down = type;
        if (type === 'flatline') this.audio.flatline();
        else this.audio.burned();
        this.setPhase('down');
        break;
    }
  }

  private makeShards(): void {
    const s = this.sim!.state;
    const [a, b] = s.ratio;
    const n = 220;
    const t = sampleTarget(a, b, s.phi, this.theta, n);
    const br = sampleBreaker(this.R, this.Phi + s.roll, a, b, this.theta, n);
    const rng = new Rng(n + ((s.t * 100) | 0));
    const out: Shard[] = [];
    for (const [f, color] of [[t, BEAM.ICE], [br, BEAM.AMBER]] as const) {
      for (let i = 0; i + 3 < n; i += 3) {
        const mx = (f.x[i] + f.x[i + 3]) / 2;
        const my = (f.y[i] + f.y[i + 3]) / 2;
        out.push({
          x0: f.x[i],
          y0: f.y[i],
          x1: f.x[i + 3],
          y1: f.y[i + 3],
          vx: mx * rng.range(0.2, 0.9) + rng.range(-0.15, 0.15),
          vy: my * rng.range(0.2, 0.9) + rng.range(0, 0.5),
          spin: rng.range(-6, 6),
          color: this.ice.cls === 'black' && color === BEAM.ICE ? SPECIAL.BLACK_ICE_EDGE : color,
        });
      }
    }
    this.shards = out;
  }

  private pushEeg(dt: number): void {
    const s = this.sim?.state;
    const neural = s?.neural ?? 0;
    const flat = this.phase === 'down' && this.down === 'flatline';
    const steps = Math.max(1, Math.round(dt * 120));
    for (let i = 0; i < steps; i++) {
      const t = this.time + i / 120;
      let v = 0;
      if (!flat) {
        const rag = 0.08 + (neural / 100) * 0.9 + (s?.grip ? 0.5 : 0);
        v = 0.35 * Math.sin(t * TAU * 1.7) * Math.sin(t * TAU * 0.31) + 0.25 * Math.sin(t * TAU * 10) * 0.4 + (Math.random() - 0.5) * rag;
        if (s?.grip && Math.random() < 0.04) v += (Math.random() - 0.5) * 2.2;
      }
      this.eeg[this.eegHead] = Math.max(-1.2, Math.min(1.2, v));
      this.eegHead = (this.eegHead + 1) % this.eeg.length;
    }
  }

  private updateAudio(dt: number): void {
    const s = this.sim?.state;
    const engaged = this.phase === 'engaged' && !!s;
    if (!s) {
      this.audio.update({ engaged: false, a: 1, b: 1, R: 1, cons: 0, m: 0, slide: null, trace: 0, dt, grip: false });
      return;
    }
    const [a, b] = s.ratio;
    const cons = 0.5 + 0.5 * Math.cos(phaseError(this.Phi + s.roll, s.phi, a, b));
    const tg = s.telegraph;
    const slide = tg ? { a: tg.next[0], b: tg.next[1], k: Math.min(1, (s.t - tg.start) / (tg.end - tg.start)) } : null;
    this.audio.update({ engaged, a, b, R: this.R, cons, m: s.m, slide, trace: s.trace, dt, grip: !!s.grip });
  }

  view(dt: number): FrameView {
    const s = this.sim?.state;
    const def = this.sim?.def;
    const ofPreset = this.tries.filter((t) => t.ice === this.iceId && t.diff === this.diffId && (t.tuning ?? 'plan') === this.tuning);
    const tg = s?.telegraph;
    return {
      time: this.time,
      dt,
      theta: this.theta,
      cls: this.ice.cls,
      iceLabel: this.ice.label,
      diffLabel: `${this.diff.label}${this.tuning === 'proposed' ? ' TUNED' : ''}`,
      phase: this.phase,
      phaseT: this.phaseT,
      layerNo: this.layerNo,
      ratio: s?.ratio ?? [1, 1],
      phi: s?.phi ?? 0,
      R: this.R,
      Phi: this.Phi,
      roll: s?.roll ?? 0,
      m: this.phase === 'engaged' ? (s?.m ?? 0) : 0,
      meter: this.phase === 'shatter' ? 1 : this.phase === 'ready' ? 0 : (s?.meter ?? 0),
      trace: s?.trace ?? 0,
      neural: s?.neural ?? 0,
      elapsed: s?.t ?? 0,
      telegraph:
        tg && s
          ? { k: (s.t - tg.start) / (tg.end - tg.start), left: tg.end - s.t, next: tg.next, nextPhi: wrapPositive(s.phi + tg.phaseJump) }
          : null,
      grip: s?.grip && def?.grip && this.phase === 'engaged' ? { left: Math.max(0, s.grip.deadline - s.t), k: (s.t - s.grip.start) / def.grip.seconds } : null,
      down: this.down,
      lastTime: this.lastTime,
      shards: this.phase === 'shatter' ? this.shards : [],
      tendrils: this.tendrils,
      eeg: this.eeg,
      eegHead: this.eegHead,
      flags: { bot: this.bot, ghost: this.ghost, purist: this.purist, reduceFlash: this.reduceFlash, muted: this.audio.muted, audio: this.audio.ready },
      summary: {
        you: summarize('YOU', ofPreset.filter((t) => !t.auto)),
        auto: summarize('AUTO', ofPreset.filter((t) => t.auto)),
        recent: ofPreset
          .slice(-6)
          .reverse()
          .map((t) => `${t.auto ? 'A' : ' '} ${t.status === 'cracked' ? t.time.toFixed(1).padStart(5, '0') + 'S' : t.status.toUpperCase()}`),
      },
    };
  }
}

function summarize(who: string, ts: TryRec[]): string {
  const ok = ts.filter((t) => t.status === 'cracked').map((t) => t.time).sort((x, y) => x - y);
  if (!ts.length) return `${who} N00`;
  const q = (p: number) => ok[Math.min(ok.length - 1, Math.floor(p * ok.length))];
  const med = ok.length ? q(0.5).toFixed(1) : '--';
  const p90 = ok.length ? q(0.9).toFixed(1) : '--';
  return `${who} N${String(ts.length).padStart(2, '0')} MED ${med} P90 ${p90} OK ${ok.length}`;
}

function load(): TryRec[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as TryRec[];
  } catch {
    return [];
  }
}

function save(t: TryRec[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(t.slice(-500)));
  } catch {
    /* storage unavailable */
  }
}

const canvas = document.getElementById('scope') as HTMLCanvasElement;
const lab = new Lab(canvas);
(window as unknown as { phaseLockLab: Lab }).phaseLockLab = lab;

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lab.update(dt);
  lab.renderer.draw(lab.view(dt));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
