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
import { midiToHz, quantizeHz } from './music/Harmony';
import { createPhaseLockVoice, type PhaseLockBed, type PhaseLockVoice } from './phaseLock';
import { createMotifVoice, type MotifVoice } from './music/motifs';
import { createMusicPlayer, type MusicPlayer } from './music/player';
import { createSequencer, pulse, type Sequencer, type TempoClock } from './music/Sequencer';
import { setListenerPose, setPannerPosition } from './spatial';
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
  clock: { bpm: number; origin: number; beat: number };
  crossfade: { from: MusicState; to: MusicState; progress: number } | null;
  pulse: number;
  phaseLock: {
    running: boolean;
    grip: boolean;
    iceL: number;
    iceR: number;
    brkL: number;
    brkR: number;
    beatingHz: number;
    cons: number;
    m: number;
  } | null;
}

interface MotifLive {
  landmarkId: string;
  stop: () => void;
  panner: PannerNode;
  voice?: MotifVoice;
}

interface MotifPending {
  landmarkId: string;
  pos: Vec3;
  corp: CorpId;
}

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
  sequencer: Sequencer = createSequencer();
  private musicPlayer: MusicPlayer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | 0 = 0;
  private duckedForGrip = false;
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
  private plVoice: PhaseLockVoice | null = null;
  private pl = {
    a: 2,
    b: 3,
    f0: 110,
    R: 1,
    phi: 0,
    Phi: 0,
    pending: false,
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

    this.sequencer = createSequencer({
      now: () => this.ctx?.currentTime ?? 0,
      bpm: this.bpm,
      root: this.root,
      mode: this.mode,
    });
    this.sequencer.align(ctx.currentTime);
    this.musicPlayer = createMusicPlayer(
      ctx,
      graph.input('music'),
      this.sequencer,
      { bass: this.bass, drums: this.drums },
      noise,
    );

    for (const [h, pending] of this.pendingMotifs) {
      this.motifs.set(h, this.startMotif(pending.landmarkId, pending.pos, pending.corp));
    }
    this.pendingMotifs.clear();

    if (this.musicState !== 'silent') this.sequencer.setState(this.musicState, ctx.currentTime);
    this.applyGripDuck();
    this.musicPlayer.tick(ctx.currentTime);
    this.musicTimer = setInterval(() => {
      if (this.ctx && this.musicPlayer) this.musicPlayer.tick(this.ctx.currentTime);
      this.plVoice?.tick(0.025);
    }, 25);

    if (this.pl.pending) {
      this.plVoice?.start(this.pl.a, this.pl.b, this.pl.f0);
      this.plVoice?.setTarget(this.pl.a, this.pl.b, this.pl.phi);
      this.plVoice?.setPlayer(this.pl.R, this.pl.Phi);
      this.syncPhaseLockVoice();
    }

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
    this.syncPhaseLockVoice();
  }

  sfx(id: SfxId, opts?: SfxOptions): void {
    this.sfxCatalog?.play(id, opts);
  }

  setMusicState(s: MusicState): void {
    this.musicState = s;
    this.sequencer.setState(s, this.ctx?.currentTime ?? 0);
    this.bpm = this.sequencer.clock.bpm;
    this.musicPlayer?.setMotifsDominant(s === 'approach');
    this.applyGripDuck();
    this.syncPhaseLockVoice();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.sequencer.setTempo(bpm, this.ctx?.currentTime ?? 0);
  }

  setKey(root: number, mode: MusicMode): void {
    this.root = root;
    this.mode = mode;
    this.sequencer.setKey(root, mode);
    this.applyPhaseLock();
  }

  setLockMeter(m: number): void {
    this.sequencer.lockMeter = m;
  }

  private applyGripDuck(): void {
    const db = this.sequencer.duckDb();
    if (db !== undefined) {
      this.graph?.duck('music', db, 3600);
      this.duckedForGrip = true;
      return;
    }
    if (this.duckedForGrip) {
      this.graph?.duck('music', 0, 0);
      this.duckedForGrip = false;
    }
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
    const voice = createMotifVoice({
      ctx,
      dest,
      landmarkId,
      pos,
      corp,
      listener: this.listenPos,
      root: this.root,
      mode: this.mode,
      dominant: this.musicState === 'approach',
    });
    this.panningModel = voice.panner.panningModel;
    this.musicPlayer?.addMotif(voice);
    return {
      landmarkId,
      panner: voice.panner,
      voice,
      stop: () => {
        this.musicPlayer?.removeMotif(voice);
        voice.stop();
      },
    };
  }

  private buildPhaseLock(ctx: AudioContext, dest: AudioNode): void {
    this.plVoice?.dispose();
    this.plVoice = createPhaseLockVoice(ctx, dest);
    this.syncPhaseLockVoice();
  }

  private quantizedF0(f0: number): number {
    return quantizeHz(Math.max(1, f0), this.root, this.mode);
  }

  private syncPhaseLockVoice(): void {
    const voice = this.plVoice;
    if (!voice) return;
    const audible = !this.settings?.value.phaseLock.visualOnly;
    voice.setAudible(audible);
    voice.setGrip(this.musicState === 'grip' && voice.running());
  }

  private applyPhaseLock(): void {
    const voice = this.plVoice;
    if (!voice) return;
    this.pl.f0 = this.quantizedF0(this.pl.f0);
    if (this.pl.pending || voice.running()) {
      voice.start(this.pl.a, this.pl.b, this.pl.f0);
      voice.setTarget(this.pl.a, this.pl.b, this.pl.phi);
      voice.setPlayer(this.pl.R, this.pl.Phi);
    }
    this.syncPhaseLockVoice();
    if (voice.running()) this.setLockMeter(voice.snapshot().m);
  }

  phaseLockStart(a: number, b: number, f0: number): void {
    this.pl.a = a;
    this.pl.b = b;
    this.pl.f0 = this.quantizedF0(f0);
    this.pl.pending = true;
    this.plVoice?.start(a, b, this.pl.f0);
    this.syncPhaseLockVoice();
  }

  phaseLockTarget(a: number, b: number, phi: number): void {
    this.pl.a = a;
    this.pl.b = b;
    this.pl.phi = phi;
    this.plVoice?.setTarget(a, b, phi);
  }

  phaseLockPlayer(R: number, Phi: number): void {
    this.pl.R = R;
    this.pl.Phi = Phi;
    this.plVoice?.setPlayer(R, Phi);
    const snap = this.plVoice?.snapshot();
    if (snap && this.plVoice?.running()) this.setLockMeter(snap.m);
  }

  phaseLockStop(): void {
    this.pl.pending = false;
    this.plVoice?.stop();
    this.syncPhaseLockVoice();
  }

  phaseLockSnapshot(): PhaseLockBed | null {
    return this.plVoice?.snapshot() ?? null;
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
    for (const live of this.motifs.values()) live.voice?.setListener(this.listenPos);
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
      clock: {
        bpm: this.sequencer.clock.bpm,
        origin: this.sequencer.clock.origin,
        beat:
          ((this.ctx?.currentTime ?? 0) - this.sequencer.clock.origin) *
          (this.sequencer.clock.bpm / 60),
      },
      crossfade: (() => {
        const cf = this.sequencer.crossfadeAt(this.ctx?.currentTime ?? 0);
        return cf ? { from: cf.fromState, to: cf.toState, progress: cf.progress } : null;
      })(),
      pulse: pulse(this.ctx?.currentTime ?? 0, this.sequencer.clock),
      phaseLock: this.plVoice
        ? (() => {
            const s = this.plVoice!.snapshot();
            return {
              running: this.plVoice!.running(),
              grip: this.plVoice!.gripping(),
              iceL: s.iceL,
              iceR: s.iceR,
              brkL: s.brkL,
              brkR: s.brkR,
              beatingHz: s.beatingHz,
              cons: s.cons,
              m: s.m,
            };
          })()
        : this.pl.pending
          ? {
              running: true,
              grip: this.musicState === 'grip',
              iceL: this.pl.a * this.pl.f0,
              iceR: this.pl.b * this.pl.f0,
              brkL: this.pl.a * this.pl.f0,
              brkR: this.pl.R * this.pl.a * this.pl.f0,
              beatingHz: Math.abs(this.pl.R * this.pl.a - this.pl.b) * this.pl.f0,
              cons: 0,
              m: 0,
            }
          : null,
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
    if (live?.voice) live.voice.setPosition(pos);
    else if (live) setPannerPosition(live.panner, pos);
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
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
    this.musicPlayer?.dispose();
    this.musicPlayer = null;
    for (const m of this.motifs.values()) m.stop();
    this.motifs.clear();
    this.pendingMotifs.clear();
    this.sfxCatalog?.dispose();
    this.sfxCatalog = null;
    this.modemVoice?.dispose();
    this.modemVoice = null;
    this.dixieVoice?.dispose();
    this.dixieVoice = null;
    this.plVoice?.dispose();
    this.plVoice = null;
    this.pl.pending = false;
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

/** Live tempo clock for renderer `pulse(t)` sync. Null on the no-op engine. */
export function getTempoClock(engine: AudioEngine): TempoClock | null {
  return intern.get(engine)?.sequencer.clock ?? null;
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
    pulse: (t) => pulse(t, impl.sequencer.clock),
    setLockMeter: (m) => impl.setLockMeter(m),
    phaseLockSnapshot: () => impl.phaseLockSnapshot(),
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
  pulse(t: number): number;
  setLockMeter(m: number): void;
  phaseLockSnapshot(): PhaseLockBed | null;
}
