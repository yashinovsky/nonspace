import type { EventBus, EventOf, Unsubscribe } from '../core/events';
import type { Action } from '../narrative/schema';

/** Mission-script gate window (plan §9.5 / §3.7). */
export interface GateDef {
  id: string;
  iceNode: string;
  tMeat: number;
  early: number;
  late: number;
  onEarly: Action[];
  onLate: Action[];
}

export type GateState = 'idle' | 'open' | 'hit' | 'early' | 'late' | 'missed';

export interface GateSnapshot {
  id: string;
  iceNode: string;
  state: GateState;
  /** 0..1 while waiting late with holdUntilOpen. */
  exposure: number;
  waiting: boolean;
}

export interface GateBranch {
  atGate: string;
  onLate: { holdUntilOpen: boolean; exposurePerSec: number; injectSegment?: string };
}

export interface GatesOptions {
  events: EventBus;
  gates?: GateDef[];
  branches?: GateBranch[];
  /** Exposure fail threshold (plan §12.3 = 1). */
  failAt?: number;
  onActions?: (actions: Action[]) => void;
}

export interface Gates {
  readonly snapshots: readonly GateSnapshot[];
  get(id: string): GateSnapshot | undefined;
  /** True if any late gate is holding the timeline. */
  readonly waiting: boolean;
  /** Frozen playback time for a wait, or null. */
  readonly waitPlayback: number | null;
  load(gates: GateDef[], branches?: GateBranch[]): void;
  reset(): void;
  /** Advance against meat time. `dt` only needed for exposure. */
  update(meatTime: number, dt: number): void;
  /** Mark the ICE node cracked (also listens for `iceLayerCracked`). */
  crack(iceNode: string): void;
  dispose(): void;
}

const FAIL_AT = 1;

export function createGates(opts: GatesOptions): Gates {
  const failAt = opts.failAt ?? FAIL_AT;
  let defs: GateDef[] = opts.gates ? opts.gates.slice() : [];
  let branches: GateBranch[] = opts.branches ? opts.branches.slice() : [];
  const snaps: GateSnapshot[] = [];
  const cracked = new Set<string>();
  let unsub: Unsubscribe | null = null;

  const branchOf = (id: string): GateBranch | undefined => branches.find((b) => b.atGate === id);

  const emit = (id: string, state: EventOf<'gateWindow'>['state']): void => {
    opts.events.post({ type: 'gateWindow', gateId: id, state });
  };

  const rebuild = (): void => {
    snaps.length = 0;
    cracked.clear();
    for (const g of defs) {
      snaps.push({ id: g.id, iceNode: g.iceNode, state: 'idle', exposure: 0, waiting: false });
    }
  };

  const crackNode = (iceNode: string): void => {
    if (!iceNode) return;
    cracked.add(iceNode);
  };

  const listen = (): void => {
    unsub?.();
    unsub = opts.events.on('iceLayerCracked', (e) => crackNode(e.iceId));
  };
  listen();
  rebuild();

  const api: Gates = {
    get snapshots() {
      return snaps;
    },
    get(id) {
      return snaps.find((s) => s.id === id);
    },
    get waiting() {
      return snaps.some((s) => s.waiting);
    },
    get waitPlayback() {
      for (let i = 0; i < snaps.length; i++) {
        if (!snaps[i]!.waiting) continue;
        const def = defs[i];
        return def ? def.tMeat : null;
      }
      return null;
    },
    load(next, nextBranches) {
      defs = next.slice();
      branches = nextBranches ? nextBranches.slice() : [];
      rebuild();
    },
    reset() {
      rebuild();
    },
    crack(iceNode) {
      crackNode(iceNode);
    },
    update(meatTime, dt) {
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i]!;
        const snap = snaps[i]!;
        const openAt = def.tMeat - def.early;
        const closeAt = def.tMeat + def.late;
        const iceHit = cracked.has(def.iceNode);
        const br = branchOf(def.id);

        if (snap.state === 'hit' || snap.state === 'early' || snap.state === 'missed') continue;

        if (snap.state === 'idle') {
          if (iceHit && meatTime < openAt) {
            snap.state = 'early';
            snap.waiting = false;
            emit(def.id, 'early');
            if (def.onEarly.length) opts.onActions?.(def.onEarly);
            continue;
          }
          if (meatTime >= openAt) {
            snap.state = 'open';
            emit(def.id, 'open');
          } else {
            continue;
          }
        }

        if (snap.state === 'open') {
          if (iceHit) {
            snap.state = 'hit';
            snap.waiting = false;
            emit(def.id, 'hit');
            continue;
          }
          if (meatTime > closeAt) {
            snap.state = 'late';
            emit(def.id, 'late');
            if (def.onLate.length) opts.onActions?.(def.onLate);
            const hold = br?.onLate.holdUntilOpen ?? true;
            snap.waiting = hold;
            if (!hold) {
              snap.state = 'missed';
              snap.waiting = false;
              emit(def.id, 'missed');
            }
          }
        }

        if (snap.state === 'late') {
          if (iceHit) {
            snap.state = 'hit';
            snap.waiting = false;
            emit(def.id, 'hit');
            continue;
          }
          const rate = br?.onLate.exposurePerSec ?? 0.04;
          snap.exposure = Math.min(failAt, snap.exposure + Math.max(0, dt) * rate);
          if (snap.exposure >= failAt) {
            snap.state = 'missed';
            snap.waiting = false;
            emit(def.id, 'missed');
          }
        }
      }
    },
    dispose() {
      unsub?.();
      unsub = null;
      snaps.length = 0;
      cracked.clear();
    },
  };

  return api;
}
