const loaded = new WeakMap<AudioContext, Set<string>>();

/**
 * Load a classic-script AudioWorklet from a source string. Returns false if
 * AudioWorklet is missing or addModule fails (caller should fall back).
 * Idempotent per (context, processor name).
 */
export async function loadWorklet(
  ctx: AudioContext,
  name: string,
  source: string,
): Promise<boolean> {
  const names = loaded.get(ctx) ?? new Set<string>();
  if (names.has(name)) return true;
  if (!ctx.audioWorklet) return false;
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
    names.add(name);
    loaded.set(ctx, names);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already been registered|already registered/i.test(msg)) {
      names.add(name);
      loaded.set(ctx, names);
      return true;
    }
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}
