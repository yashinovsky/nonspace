import { closeSync, constants, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Shared by sector hitch AC and the render GPU-inject test — they must not overlap on SwiftShader. */
const LOCK = join(tmpdir(), 'nonspace-swiftshader-sector.lock');

export async function withSectorHitchLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 90_000;
  let fd: number | undefined;
  while (Date.now() < deadline) {
    try {
      fd = openSync(LOCK, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  if (fd === undefined) throw new Error('swiftshader sector lock timed out');
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(LOCK);
    } catch {
      /* already released */
    }
  }
}
