/** Target callback size from M5.1 AC (128-frame buffers on the reference machine). */
export const TARGET_BUFFER_FRAMES = 128;
export const TARGET_SAMPLE_RATE = 48000;

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

export function getAudioContextCtor(): AudioContextCtor | undefined {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

export function createGameAudioContext(): AudioContext {
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('Web Audio is not available');
  try {
    return new Ctor({ latencyHint: TARGET_BUFFER_FRAMES / TARGET_SAMPLE_RATE });
  } catch {
    return new Ctor({ latencyHint: 'interactive' });
  }
}

export function bufferFramesOf(ctx: AudioContext): number | null {
  const sr = ctx.sampleRate;
  if (!sr) return null;
  const frames = Math.round(ctx.baseLatency * sr);
  return Number.isFinite(frames) ? frames : null;
}
