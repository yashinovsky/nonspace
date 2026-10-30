import type { CorpId } from '../content/corps';
import type { Vec3 } from '../core/math/vec3';
import type { SettingsStore } from '../core/settings';
import type {
  AudioBus,
  AudioEngine,
  Handle,
  MusicMode,
  MusicState,
  SfxId,
  SfxOptions,
} from './AudioEngine';
import { createBusGraph, type AudioBusGraph } from './buses';
import { bufferFramesOf, createGameAudioContext, getAudioContextCtor } from './context';
import { createDixieVoice, type DixieVoice } from './dixieVoice';
import { createModem, type ModemInfo, type ModemVoice } from './modem';
import { createHrtfPanner, setListenerPose, setPannerPosition } from './spatial';
import { createSfxCatalog, type SfxCatalog } from './sfx/catalog';
import type { FlatlinePhase } from './sfx/recipes/flatline';
import { createBassVoice, type BassVoice } from './voices/Bass';
import { createDrumVoice, createNoiseBuffer, type DrumVoice } from './voices/Drums';
import { createFmVoicePool, type FmVoicePool } from './voices/FmVoice';
import { createSubVoicePool, type SubVoicePool } from './voices/SubVoice';
import { fmWorkletSource, FM_WORKLET_NAME } from './worklets/fm.worklet';
import { loadWorklet } from './worklets/load';
import { noiseWorkletSource, NOISE_WORKLET_NAME } from './worklets/noise.worklet';

export interface CreateAudioEngineOptions {
  settings?: SettingsStore;
}

export interface AudioDiagnostics {
  unlocked: boolean;
  contextState: string | null;
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  bufferFrames: number | null;
  fmActive: number;
  fmSize: number;
  worklets: { fm: boolean; noise: boolean };
  motifCount: number;
  duckGain: { all: number; music: number };
  panningModel: string | null;
  music: { state: MusicState; bpm: number; root: number; mode: MusicMode };
}

interface MotifLive {
  landmarkId: string;
  stop: () => void;
  panner: PannerNode;
}

interface MotifPending {
  landmarkId: string;
  pos: Vec3;
  corp: CorpId;
}

const MOTIF_SPEC: Record<
  CorpId,
  {
    freq: number;
    type: OscillatorType;
    amp: number;
    lfoHz: number;
    lfoGain: number;
    lfoPitch: number;
  }
> = {
  tessierAshpool: { freq: 110, type: 'sine', amp: 0.05, lfoHz: 0.12, lfoGain: 0.015, lfoPitch: 2 },
  mitsubishi: { freq: 660, type: 'triangle', amp: 0.04, lfoHz: 4, lfoGain: 0.02, lfoPitch: 0 },
  esfa: { freq: 55, type: 'square', amp: 0.06, lfoHz: 1, lfoGain: 0.05, lfoPitch: 0 },
  senseNet: { freq: 523, type: 'square', amp: 0.035, lfoHz: 2, lfoGain: 0.02, lfoPitch: 0 },
  hosaka: { freq: 220, type: 'sawtooth', amp: 0.04, lfoHz: 0.3, lfoGain: 0.01, lfoPitch: 4 },
  turing: { freq: 1760, type: 'sine', amp: 0.03, lfoHz: 0.25, lfoGain: 0.01, lfoPitch: 0 },
  military: { freq: 80, type: 'sine', amp: 0.05, lfoHz: 0.07, lfoGain: 0.01, lfoPitch: 18 },
  minor: { freq: 165, type: 'sine', amp: 0.04, lfoHz: 0.2, lfoGain: 0.01, lfoPitch: 1 },
};

const intern = new WeakMap<AudioEngine, EngineImpl>();

class EngineImpl {
  unlocked = false;
  ctx: AudioContext | null = null;
  graph: AudioBusGraph | null = null;
  fm: FmVoicePool | null = null;
  sub: SubVoicePool | null = null;
  drums: DrumVoice | null = null;
  bass: BassVoice | null = null;
  worklets = { fm: false, noise: false };
  panningModel: string | null = null;
  musicState: MusicState = 'silent';
  bpm = 96;
  root = 45;
  mode: MusicMode = 'minor';
  private readonly settings?: SettingsStore;
  private unsubSettings?: () => void;
  private unlocking: Promise<void> | null = null;
  private nextHandle = 1;
  private readonly motifs = new Map<Handle, MotifLive>();
  private readonly pendingMotifs = new Map<Handle, MotifPending>();
  private readonly listenPos = { x: 0, y: 0, z: 0 };
  private readonly listenFwd = { x: 0, y: 0, z: -1 };
  private readonly listenUp = { x: 0, y: 1, z: 0 };
  private noiseKeepalive: AudioNode | null = null;
  private sfxCatalog: SfxCatalog | null = null;
  private modemVoice: ModemVoice | null = null;
  private dixieVoice: DixieVoice | null = null;
  private pl = {
    a: 2,
    b: 3,
    f0: 110,
    R: 1,
    iceA: null as OscillatorNode | null,
    iceB: null as OscillatorNode | null,
    player: null as OscillatorNode | null,
    gain: null as GainNode | null,
  };

  constructor(opts?: CreateAudioEngineOptions) {
    this.settings = opts?.settings;
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.unlocking ??= this.doUnlock();
    await this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    if (!getAudioContextCtor()) return;
    const ctx = createGameAudioContext();
    this.ctx = ctx;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* autoplay policy; graph still builds */
    }
    const graph = createBusGraph(ctx);
    this.graph = graph;
    this.applyGains();
    this.unsubSettings = this.settings?.onChange(() => this.applyGains());

    this.worklets.fm = await loadWorklet(ctx, FM_WORKLET_NAME, fmWorkletSource());
    this.worklets.noise = await loadWorklet(ctx, NOISE_WORKLET_NAME, noiseWorkletSource());

    const fm = createFmVoicePool(ctx, graph.input('sfx'), this.worklets.fm);
    this.fm = fm;
    this.sub = createSubVoicePool(ctx, graph.input('music'));
    this.bass = createBassVoice(ctx, graph.input('music'));

    const noise = this.makeNoiseSource(ctx);
    this.drums = createDrumVoice(ctx, graph.input('sfx'), noise);

    this.buildPhaseLock(ctx, graph.input('sfx'));
    this.modemVoice = createModem(ctx, graph.input('sfx'));
    this.dixieVoice = createDixieVoice(ctx, graph.input('voice'), noise);
    this.sfxCatalog = createSfxCatalog({
      ctx,
      graph,
      fm,
      noise,
      duck: (bus, db, seconds) => this.duck(bus, db, seconds),
      key: () => ({ root: this.root, mode: this.mode }),
    });
    setListenerPose(ctx.listener, this.listenPos, this.listenFwd, this.listenUp);

    for (const [h, pending] of this.pendingMotifs) {
      this.motifs.set(h, this.startMotif(pending.landmarkId, pending.pos, pending.corp));
    }
    this.pendingMotifs.clear();

    this.unlocked = true;
  }

  private makeNoiseSource(ctx: AudioContext): AudioNode {
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);
    this.noiseKeepalive = silent;
    if (this.worklets.noise) {
      const node = new AudioWorkletNode(ctx, NOISE_WORKLET_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(silent);
      return node;
    }
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, 1);
    src.loop = true;
    src.connect(silent);
    src.start();
    return src;
  }

  private applyGains(): void {
    const g = this.graph;
    if (!g) return;
    const a = this.settings?.value.audio ?? { master: 0.8, music: 0.7, sfx: 0.8, voice: 0.9 };
    g.setBusGain('master', a.master);
    g.setBusGain('music', a.music);
    g.setBusGain('sfx', a.sfx);
    g.setBusGain('ui', a.sfx);
    g.setBusGain('ambience', a.sfx);
    g.setBusGain('voice', a.voice);
  }

  sfx(id: SfxId, opts?: SfxOptions): void {
    this.sfxCatalog?.play(id, opts);
  }

  setMusicState(s: MusicState): void {
    this.musicState = s;
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
  }

  setKey(root: number, mode: MusicMode): void {
    this.root = root;
    this.mode = mode;
  }

  attachMotif(landmarkId: string, pos: Vec3, corp: CorpId): Handle {
    const h = this.nextHandle++ as Handle;
    const copy = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.unlocked || !this.ctx || !this.graph) {
      this.pendingMotifs.set(h, { landmarkId, pos: copy, corp });
      return h;
    }
    this.motifs.set(h, this.startMotif(landmarkId, copy, corp));
    return h;
  }

  detachMotif(h: Handle): void {
    this.pendingMotifs.delete(h);
    const live = this.motifs.get(h);
    if (!live) return;
    live.stop();
    this.motifs.delete(h);
  }

  private startMotif(landmarkId: string, pos: Vec3, corp: CorpId): MotifLive {
    const ctx = this.ctx!;
    const dest = this.graph!.input('music');
    const spec = MOTIF_SPEC[corp] ?? MOTIF_SPEC.minor;
    const panner = createHrtfPanner(ctx, pos);
    this.panningModel = panner.panningModel;
    panner.connect(dest);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.value = spec.freq;
    amp.gain.value = spec.amp;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = spec.lfoHz;
    lfoGain.gain.value = spec.lfoGain;
    lfo.connect(lfoGain).connect(amp.gain);
    if (spec.lfoPitch) {
      const pitch = ctx.createGain();
      pitch.gain.value = spec.lfoPitch;
      lfo.connect(pitch).connect(osc.frequency);
    }
    osc.connect(amp).connect(panner);
    const t = ctx.currentTime;
    osc.start(t);
    lfo.start(t);
    return {
      landmarkId,
      panner,
      stop() {
        const now = ctx.currentTime;
        amp.gain.setTargetAtTime(0.0001, now, 0.05);
        try {
          osc.stop(now + 0.3);
          lfo.stop(now + 0.3);
        } catch {
          /* already stopped */
        }
        panner.disconnect();
      },
    };
  }

  private buildPhaseLock(ctx: AudioContext, dest: AudioNode): void {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(dest);
    const iceA = ctx.createOscillator();
    const iceB = ctx.createOscillator();
    const player = ctx.createOscillator();
    iceA.type = 'sine';
    iceB.type = 'sine';
    player.type = 'triangle';
    iceA.connect(gain);
    iceB.connect(gain);
    player.connect(gain);
    iceA.start();
    iceB.start();
    player.start();
    this.pl.iceA = iceA;
    this.pl.iceB = iceB;
    this.pl.player = player;
    this.pl.gain = gain;
  }

  phaseLockStart(a: number, b: number, f0: number): void {
    this.pl.a = a;
    this.pl.b = b;
    this.pl.f0 = f0;
    this.applyPhaseLock();
    const t = this.ctx?.currentTime ?? 0;
    this.pl.gain?.gain.setTargetAtTime(0.08, t, 0.04);
  }

  phaseLockTarget(a: number, b: number, _phi: number): void {
    this.pl.a = a;
    this.pl.b = b;
    this.applyPhaseLock();
  }

  phaseLockPlayer(R: number, _Phi: number): void {
    this.pl.R = R;
    this.applyPhaseLock();
  }

  phaseLockStop(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.pl.gain?.gain.setTargetAtTime(0.0001, t, 0.04);
  }

  private applyPhaseLock(): void {
    const t = this.ctx?.currentTime ?? 0;
    const f0 = this.pl.f0;
    this.pl.iceA?.frequency.setTargetAtTime(this.pl.a * f0, t, 0.02);
    this.pl.iceB?.frequency.setTargetAtTime(this.pl.b * f0, t, 0.02);
    this.pl.player?.frequency.setTargetAtTime(Math.min(4000, this.pl.R * this.pl.a * f0), t, 0.01);
  }

  modemStart(): void {
    this.modemVoice?.start();
  }

  modemStop(): void {
    this.modemVoice?.stop();
  }

  duck(bus: AudioBus, db: number, seconds: number): void {
    this.graph?.duck(bus, db, seconds);
  }

  listener(pos: Vec3, forward: Vec3, up: Vec3): void {
    this.listenPos.x = pos.x;
    this.listenPos.y = pos.y;
    this.listenPos.z = pos.z;
    this.listenFwd.x = forward.x;
    this.listenFwd.y = forward.y;
    this.listenFwd.z = forward.z;
    this.listenUp.x = up.x;
    this.listenUp.y = up.y;
    this.listenUp.z = up.z;
    if (this.ctx) setListenerPose(this.ctx.listener, this.listenPos, this.listenFwd, this.listenUp);
  }

  diagnostics(): AudioDiagnostics {
    const ctx = this.ctx;
    return {
      unlocked: this.unlocked,
      contextState: ctx?.state ?? null,
      sampleRate: ctx?.sampleRate ?? null,
      baseLatency: ctx?.baseLatency ?? null,
      outputLatency: ctx
        ? ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null)
        : null,
      bufferFrames: ctx ? bufferFramesOf(ctx) : null,
      fmActive: this.fm?.active() ?? 0,
      fmSize: this.fm?.size ?? 0,
      worklets: { ...this.worklets },
      motifCount: this.motifs.size + this.pendingMotifs.size,
      duckGain: {
        all: this.graph?.getDuckGain('all') ?? 1,
        music: this.graph?.getDuckGain('music') ?? 1,
      },
      panningModel: this.panningModel,
      music: { state: this.musicState, bpm: this.bpm, root: this.root, mode: this.mode },
    };
  }

  playChord16(): number[] {
    const ids: number[] = [];
    if (!this.fm) return ids;
    const f0 = midiToHz(this.root);
    const ratios = [
      1,
      9 / 8,
      5 / 4,
      4 / 3,
      3 / 2,
      5 / 3,
      2,
      9 / 4,
      5 / 2,
      8 / 3,
      3,
      10 / 3,
      4,
      9 / 2,
      5,
      6,
    ];
    for (let i = 0; i < 16; i++) {
      ids.push(
        this.fm.noteOn({
          freq: f0 * ratios[i]!,
          amp: 0.045,
          pan: (i / 15) * 2 - 1,
          ratio: 2 + (i % 3) * 0.5,
          index: 1.2 + (i % 4) * 0.3,
          attack: 0.01,
          decay: 0.2,
          sustain: 0.7,
          release: 0.25,
        }),
      );
    }
    return ids;
  }

  stopVoices(): void {
    this.fm?.allOff();
    this.sub?.allOff();
    this.bass?.noteOff();
  }

  noteSub(): void {
    this.sub?.noteOn({ freq: midiToHz(this.root) * 2, amp: 0.08 });
  }

  noteBass(): void {
    this.bass?.noteOn({ freq: midiToHz(this.root) / 2 });
  }

  noteDrum(kind: 'kick' | 'snare' | 'hat'): void {
    if (kind === 'kick') this.drums?.kick();
    else if (kind === 'snare') this.drums?.snare();
    else this.drums?.hat(0.12, false);
  }

  moveMotif(h: Handle, pos: Vec3): void {
    const live = this.motifs.get(h);
    if (live) setPannerPosition(live.panner, pos);
    const pending = this.pendingMotifs.get(h);
    if (pending) {
      pending.pos.x = pos.x;
      pending.pos.y = pos.y;
      pending.pos.z = pos.z;
    }
  }

  setFlight(speed: number): void {
    this.sfxCatalog?.setFlight(speed);
  }

  flightSpeed(): number {
    return this.sfxCatalog?.flightSpeed() ?? 0;
  }

  dixie(): DixieVoice | null {
    return this.dixieVoice;
  }

  flatlinePhase(): FlatlinePhase {
    return this.sfxCatalog?.flatline.phase() ?? 'idle';
  }

  modemInfo(): ModemInfo {
    return (
      this.modemVoice?.info() ?? {
        running: false,
        baud: 300,
        originate: [1070, 1270],
        answer: [2025, 2225],
        live: { originate: 1270, answer: 2225 },
      }
    );
  }

  dispose(): void {
    this.unsubSettings?.();
    this.unsubSettings = undefined;
    for (const m of this.motifs.values()) m.stop();
    this.motifs.clear();
    this.pendingMotifs.clear();
    this.sfxCatalog?.dispose();
    this.sfxCatalog = null;
    this.modemVoice?.dispose();
    this.modemVoice = null;
    this.dixieVoice?.dispose();
    this.dixieVoice = null;
    this.fm?.dispose();
    this.sub?.dispose();
    this.drums?.dispose();
    this.bass?.dispose();
    this.noiseKeepalive?.disconnect();
    this.graph?.dispose();
    const ctx = this.ctx;
    this.ctx = null;
    this.graph = null;
    this.unlocked = false;
    this.unlocking = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function createAudioEngine(opts?: CreateAudioEngineOptions): AudioEngine {
  const impl = new EngineImpl(opts);
  const engine: AudioEngine = {
    unlock: () => impl.unlock(),
    sfx: (id, o) => impl.sfx(id, o),
    music: {
      setState: (s) => impl.setMusicState(s),
      setTempo: (bpm) => impl.setTempo(bpm),
      setKey: (root, mode) => impl.setKey(root, mode),
    },
    motif: {
      attach: (id, pos, corp) => impl.attachMotif(id, pos, corp),
      detach: (h) => impl.detachMotif(h),
    },
    phaseLock: {
      start: (a, b, f0) => impl.phaseLockStart(a, b, f0),
      setTarget: (a, b, phi) => impl.phaseLockTarget(a, b, phi),
      setPlayer: (R, Phi) => impl.phaseLockPlayer(R, Phi),
      stop: () => impl.phaseLockStop(),
    },
    modem: {
      start: () => impl.modemStart(),
      stop: () => impl.modemStop(),
    },
    duck: (bus, db, seconds) => impl.duck(bus, db, seconds),
    listener: (pos, forward, up) => impl.listener(pos, forward, up),
  };
  intern.set(engine, impl);
  return engine;
}

export function getAudioDiagnostics(engine: AudioEngine): AudioDiagnostics | null {
  return intern.get(engine)?.diagnostics() ?? null;
}

export function disposeAudioEngine(engine: AudioEngine): void {
  intern.get(engine)?.dispose();
}

/** Lab / e2e hooks. Null for the no-op engine. */
export function getAudioEngineHandle(engine: AudioEngine): EngineLabHandle | null {
  const impl = intern.get(engine);
  if (!impl) return null;
  return {
    playChord16: () => impl.playChord16(),
    stopVoices: () => impl.stopVoices(),
    noteSub: () => impl.noteSub(),
    noteBass: () => impl.noteBass(),
    noteDrum: (k) => impl.noteDrum(k),
    moveMotif: (h, pos) => impl.moveMotif(h, pos),
    diagnostics: () => impl.diagnostics(),
    setFlight: (speed) => impl.setFlight(speed),
    flightSpeed: () => impl.flightSpeed(),
    dixie: () => impl.dixie(),
    flatlinePhase: () => impl.flatlinePhase(),
    modemInfo: () => impl.modemInfo(),
  };
}

export interface EngineLabHandle {
  playChord16(): number[];
  stopVoices(): void;
  noteSub(): void;
  noteBass(): void;
  noteDrum(kind: 'kick' | 'snare' | 'hat'): void;
  moveMotif(h: Handle, pos: Vec3): void;
  diagnostics(): AudioDiagnostics;
  /** M5.2: beam-hiss level (0 = off). */
  setFlight(speed: number): void;
  flightSpeed(): number;
  dixie(): DixieVoice | null;
  flatlinePhase(): FlatlinePhase;
  modemInfo(): ModemInfo;
}
