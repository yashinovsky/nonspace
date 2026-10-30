import type { CorpId } from '../../content/corps';
import type { Vec3 } from '../../core/math/vec3';
import type { MusicMode } from '../AudioEngine';
import { DEFAULT_PANNER, createHrtfPanner, setPannerPosition, type PannerConfig } from '../spatial';
import { DEFAULT_MODE, DEFAULT_ROOT_MIDI, degreeToHz, midiToHz, PENTATONIC_MINOR } from './Harmony';

export const MOTIF_ATTACH_SECONDS = 0.12;
export const MOTIF_DETACH_SECONDS = 0.25;
/** Turing sweep ping period (plan §5.4 / §7.2). */
export const TURING_PING_PERIOD = 4;

export type MotifKind =
  'organ' | 'bells' | 'throb' | 'ident' | 'ping' | 'whale' | 'ticks' | 'drone';

export interface MotifSpec {
  corp: CorpId;
  kind: MotifKind;
  amp: number;
  /** 16th steps that fire; empty means continuous. */
  steps: readonly number[];
  /** Sense/Net ident: only on bars where bar % barModulo === 0. */
  barModulo?: number;
}

/** Plan §7.2 corporate motifs. */
export const CORP_MOTIFS: Record<CorpId, MotifSpec> = {
  tessierAshpool: { corp: 'tessierAshpool', kind: 'organ', amp: 0.055, steps: [] },
  mitsubishi: {
    corp: 'mitsubishi',
    kind: 'bells',
    amp: 0.045,
    steps: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  esfa: { corp: 'esfa', kind: 'throb', amp: 0.07, steps: [] },
  senseNet: { corp: 'senseNet', kind: 'ident', amp: 0.05, steps: [0], barModulo: 2 },
  hosaka: { corp: 'hosaka', kind: 'ticks', amp: 0.04, steps: [0, 4, 8, 12] },
  turing: { corp: 'turing', kind: 'ping', amp: 0.035, steps: [] },
  military: { corp: 'military', kind: 'whale', amp: 0.04, steps: [] },
  minor: { corp: 'minor', kind: 'drone', amp: 0.04, steps: [] },
};

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Inverse-distance motif envelope matching the HRTF panner. 1 inside
 * refDistance, 0 at/beyond maxDistance — attach and detach with distance.
 */
export function motifDistanceGain(distance: number, cfg: PannerConfig = DEFAULT_PANNER): number {
  if (!(distance < cfg.maxDistance)) return 0;
  if (!(distance > cfg.refDistance)) return 1;
  return Math.pow(cfg.refDistance / distance, cfg.rolloffFactor);
}

export function shouldAttachMotif(distance: number, cfg: PannerConfig = DEFAULT_PANNER): boolean {
  return motifDistanceGain(distance, cfg) > 0.02;
}

export interface MotifVoice {
  readonly corp: CorpId;
  readonly landmarkId: string;
  readonly panner: PannerNode;
  setPosition(pos: Vec3): void;
  setListener(pos: Vec3): void;
  setKey(root: number, mode: MusicMode): void;
  setDominant(on: boolean): void;
  /** Fire grid-synced motif notes (bells, ident, ticks). */
  step(step: number, bar: number, when: number): void;
  /** Time-based motifs (Turing 0.25 Hz sweep ping). */
  poll(when: number): void;
  stop(): void;
}

interface MotifOpts {
  ctx: AudioContext;
  dest: AudioNode;
  landmarkId: string;
  pos: Vec3;
  corp: CorpId;
  listener: Vec3;
  root?: number;
  mode?: MusicMode;
  dominant?: boolean;
}

function envGain(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function startOsc(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  dest: AudioNode,
  at: number,
  bag: OscillatorNode[],
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(dest);
  osc.start(at);
  bag.push(osc);
  return osc;
}

/**
 * Positional corp motif through an HRTF panner. Distance gain is applied on
 * a dedicated node so far landmarks fall silent (sonic detach) and near
 * ones attach; the API fade covers explicit attach/detach.
 */
export function createMotifVoice(opts: MotifOpts): MotifVoice {
  const { ctx, dest, landmarkId, corp } = opts;
  const spec = CORP_MOTIFS[corp] ?? CORP_MOTIFS.minor;
  const pos = { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z };
  const listen = { x: opts.listener.x, y: opts.listener.y, z: opts.listener.z };
  let root = opts.root ?? DEFAULT_ROOT_MIDI;
  let mode: MusicMode = opts.mode ?? DEFAULT_MODE;
  let dominant = opts.dominant ?? false;
  let lastPing = -1e9;
  const bellIndex = { i: 0 };

  const panner = createHrtfPanner(ctx, pos);
  const distGain = ctx.createGain();
  const attachGain = ctx.createGain();
  const mix = ctx.createGain();
  mix.gain.value = spec.amp;
  attachGain.gain.value = 0.0001;
  distGain.gain.value = motifDistanceGain(distance3(pos, listen));
  mix.connect(attachGain).connect(distGain).connect(panner).connect(dest);

  const t0 = ctx.currentTime;
  attachGain.gain.setValueAtTime(0.0001, t0);
  attachGain.gain.linearRampToValueAtTime(1, t0 + MOTIF_ATTACH_SECONDS);

  const oscs: OscillatorNode[] = [];

  if (spec.kind === 'organ') {
    startOsc(ctx, 'sine', midiToHz(root), mix, t0, oscs);
    startOsc(ctx, 'sine', midiToHz(root + 7), mix, t0, oscs);
    startOsc(ctx, 'sine', midiToHz(root + 12), mix, t0, oscs);
    const lfo = startOsc(ctx, 'sine', 0.1, mix, t0, oscs);
    lfo.disconnect();
    const lfoG = ctx.createGain();
    lfoG.gain.value = spec.amp * 0.35;
    lfo.connect(lfoG).connect(mix.gain);
  } else if (spec.kind === 'throb') {
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 180;
    filt.Q.value = 8;
    const osc = startOsc(ctx, 'square', Math.max(32, midiToHz(root - 12)), filt, t0, oscs);
    osc.frequency.value = Math.max(32, midiToHz(root - 12));
    filt.connect(mix);
    const lfo = startOsc(ctx, 'sine', 1, mix, t0, oscs);
    lfo.disconnect();
    const ampLfo = ctx.createGain();
    ampLfo.gain.value = spec.amp * 0.5;
    lfo.connect(ampLfo).connect(mix.gain);
    const sweep = startOsc(ctx, 'sine', 0.07, mix, t0, oscs);
    sweep.disconnect();
    const sweepG = ctx.createGain();
    sweepG.gain.value = 240;
    sweep.connect(sweepG).connect(filt.frequency);
  } else if (spec.kind === 'whale') {
    const a = startOsc(ctx, 'sine', 70, mix, t0, oscs);
    startOsc(ctx, 'sine', 73.5, mix, t0, oscs);
    const lfo = startOsc(ctx, 'sine', 0.07, mix, t0, oscs);
    lfo.disconnect();
    const pg = ctx.createGain();
    pg.gain.value = 18;
    lfo.connect(pg).connect(a.frequency);
  } else if (spec.kind === 'drone') {
    startOsc(ctx, 'sine', midiToHz(root), mix, t0, oscs);
    startOsc(ctx, 'sine', midiToHz(root + 3), mix, t0, oscs);
  }

  const applyMix = (): void => {
    mix.gain.setTargetAtTime(spec.amp * (dominant ? 1.7 : 1), ctx.currentTime, 0.05);
  };

  const applyDistance = (): void => {
    distGain.gain.setTargetAtTime(motifDistanceGain(distance3(pos, listen)), ctx.currentTime, 0.03);
  };

  const pingAt = (when: number, freq: number, amp: number, decay = 0.18): void => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = spec.kind === 'ticks' ? 'square' : 'sine';
    osc.frequency.value = freq;
    envGain(g, when, amp, 0.004, decay);
    osc.connect(g).connect(mix);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  };

  applyMix();
  applyDistance();

  return {
    corp,
    landmarkId,
    panner,
    setPosition(next) {
      pos.x = next.x;
      pos.y = next.y;
      pos.z = next.z;
      setPannerPosition(panner, pos);
      applyDistance();
    },
    setListener(next) {
      listen.x = next.x;
      listen.y = next.y;
      listen.z = next.z;
      applyDistance();
    },
    setKey(nextRoot, nextMode) {
      root = nextRoot;
      mode = nextMode;
    },
    setDominant(on) {
      dominant = on;
      applyMix();
    },
    step(step, bar, when) {
      if (spec.kind === 'bells') {
        if (!spec.steps.includes(step)) return;
        const pc = PENTATONIC_MINOR[bellIndex.i % PENTATONIC_MINOR.length]!;
        bellIndex.i++;
        pingAt(when, midiToHz(root + 12 + pc), 0.9, 0.22);
        return;
      }
      if (spec.kind === 'ident') {
        const mod = spec.barModulo ?? 2;
        if (bar % mod !== 0 || step !== 0) return;
        pingAt(when, degreeToHz(0, root, mode, 1), 1, 0.35);
        pingAt(when, degreeToHz(2, root, mode, 1), 0.7, 0.35);
        pingAt(when, degreeToHz(4, root, mode, 1), 0.7, 0.35);
        return;
      }
      if (spec.kind === 'ticks') {
        if (!spec.steps.includes(step)) return;
        pingAt(when, midiToHz(root + 24), 0.55, 0.04);
      }
    },
    poll(when) {
      if (spec.kind !== 'ping') return;
      if (when - lastPing < TURING_PING_PERIOD) return;
      lastPing = when;
      pingAt(when, midiToHz(root + 36), 0.85, 0.12);
    },
    stop() {
      const t = ctx.currentTime;
      attachGain.gain.cancelScheduledValues(t);
      attachGain.gain.setValueAtTime(Math.max(0.0001, attachGain.gain.value), t);
      attachGain.gain.linearRampToValueAtTime(0.0001, t + MOTIF_DETACH_SECONDS);
      for (const osc of oscs) {
        try {
          osc.stop(t + MOTIF_DETACH_SECONDS + 0.05);
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
