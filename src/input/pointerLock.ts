/**
 * Pointer-lock helper (plan §8.8). Mouse look only samples while locked.
 * Esc exits lock at the browser level; we surface that as an unlock so the
 * Input service can treat it as pause.
 */

export interface PointerDelta {
  dx: number;
  dy: number;
}

export interface PointerLockControl {
  readonly locked: boolean;
  /** Request lock on `target`. Safe to call without a user gesture; the browser may ignore it. */
  request(): void;
  /**
   * Exit lock. `silent` means the next unlock event is ours (text capture,
   * dispose) and should not be treated as a pause tap.
   */
  exit(silent?: boolean): void;
  /** Movement since the last consume, then zeros the accumulator. Reuses one object. */
  consumeDelta(): PointerDelta;
  /** True once if lock was lost since the last call for a reason other than `exit(true)`. */
  consumeUserUnlock(): boolean;
  attach(target: HTMLElement): void;
  detach(): void;
}

export interface PointerLockHost {
  document?: Document;
}

export function createPointerLock(opts: PointerLockHost = {}): PointerLockControl {
  const doc = opts.document;
  const delta: PointerDelta = { dx: 0, dy: 0 };
  let target: HTMLElement | null = null;
  let locked = false;
  let silentExit = false;
  let userUnlock = false;

  const onMove = (e: Event): void => {
    if (!locked) return;
    const ev = e as MouseEvent;
    delta.dx += ev.movementX;
    delta.dy += ev.movementY;
  };

  const onChange = (): void => {
    if (!doc) return;
    const now = doc.pointerLockElement === target && target !== null;
    if (locked && !now) {
      if (silentExit) silentExit = false;
      else userUnlock = true;
      delta.dx = 0;
      delta.dy = 0;
    }
    locked = now;
  };

  const onError = (): void => {
    locked = false;
  };

  const control: PointerLockControl = {
    get locked() {
      return locked;
    },
    request() {
      if (!target || locked) return;
      const req = target.requestPointerLock as (opts?: { unadjustedMovement?: boolean }) => void;
      try {
        req.call(target, { unadjustedMovement: true });
      } catch {
        try {
          target.requestPointerLock();
        } catch {
          // No user gesture, or the browser refused. Stay unlocked.
        }
      }
    },
    exit(silent = false) {
      if (!doc || !locked) return;
      silentExit = silent;
      try {
        doc.exitPointerLock();
      } catch {
        silentExit = false;
      }
    },
    consumeDelta() {
      consumeScratch.dx = delta.dx;
      consumeScratch.dy = delta.dy;
      delta.dx = 0;
      delta.dy = 0;
      return consumeScratch;
    },
    consumeUserUnlock() {
      const v = userUnlock;
      userUnlock = false;
      return v;
    },
    attach(el) {
      control.detach();
      target = el;
      if (!doc) return;
      doc.addEventListener('pointerlockchange', onChange);
      doc.addEventListener('pointerlockerror', onError);
      doc.addEventListener('mousemove', onMove);
      locked = doc.pointerLockElement === target;
    },
    detach() {
      if (doc) {
        doc.removeEventListener('pointerlockchange', onChange);
        doc.removeEventListener('pointerlockerror', onError);
        doc.removeEventListener('mousemove', onMove);
      }
      target = null;
      locked = false;
      silentExit = false;
      userUnlock = false;
      delta.dx = 0;
      delta.dy = 0;
    },
  };
  return control;
}

const consumeScratch: PointerDelta = { dx: 0, dy: 0 };

/** Programmable lock for unit tests (no DOM). */
export function createFakePointerLock(): PointerLockControl & {
  setLocked(v: boolean, userUnlock?: boolean): void;
  move(dx: number, dy: number): void;
} {
  const delta: PointerDelta = { dx: 0, dy: 0 };
  const scratch: PointerDelta = { dx: 0, dy: 0 };
  let locked = false;
  let userUnlock = false;
  return {
    get locked() {
      return locked;
    },
    request() {
      locked = true;
    },
    exit(silent = false) {
      if (!locked) return;
      locked = false;
      if (!silent) userUnlock = true;
      delta.dx = 0;
      delta.dy = 0;
    },
    consumeDelta() {
      scratch.dx = delta.dx;
      scratch.dy = delta.dy;
      delta.dx = 0;
      delta.dy = 0;
      return scratch;
    },
    consumeUserUnlock() {
      const v = userUnlock;
      userUnlock = false;
      return v;
    },
    attach() {},
    detach() {
      locked = false;
      userUnlock = false;
      delta.dx = 0;
      delta.dy = 0;
    },
    setLocked(v, unlockAsUser = false) {
      if (locked && !v && unlockAsUser) userUnlock = true;
      locked = v;
      if (!v) {
        delta.dx = 0;
        delta.dy = 0;
      }
    },
    move(dx, dy) {
      if (!locked) return;
      delta.dx += dx;
      delta.dy += dy;
    },
  };
}
