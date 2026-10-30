import type { IceModel } from '../breach/IceModel';
import type { EventBus, Unsubscribe } from '../core/events';
import type { SaveStore } from '../core/save';
import {
  AUTO_HOLD_DECAY,
  ERASE_PROMPT,
  READ_COOLDOWN_S,
  READ_DELAY_S,
  barkOccupancy,
  canStartBark,
  createBarkGate,
  eraseNoBark,
  eraseYesBark,
  flatlineBark,
  gripEndBark,
  gripStartBark,
  iceCrackedBark,
  iceEngagedBark,
  iceRekeyBark,
  iceTelegraphBark,
  isSpeaking,
  markBarkStarted,
  readResultBark,
  simstimHoldBark,
  type BarkGate,
  type BarkLine,
} from './barks';

export {
  AUTO_HOLD_DECAY,
  BARK_GAP_S,
  ERASE_LICENSE_LABEL,
  ERASE_PROMPT,
  READ_COOLDOWN_S,
  READ_DELAY_S,
} from './barks';

/**
 * Same shape as M4.4 `deck/softs/registry.ts` `DixieReadApi`. Softs forwards
 * `H` to `world.dixie.read(ice)` and no-ops with `fail: 'no-companion'` when
 * this is missing. Do not import this module from `content/softs.ts`.
 */
export interface DixieReadApi {
  /** Start a 4 s ICE read. False if cooling down, already reading, or no ICE. */
  read(ice: IceModel | null): boolean;
}

/** @deprecated Use `DixieReadApi`. Kept so lab tests can call `ask()` without ICE. */
export interface AskDixie extends DixieReadApi {
  ask(): boolean;
  readonly cooldown: number;
  readonly reading: number;
}

let readHook: DixieReadApi | null = null;

export function setDixieReadApi(next: DixieReadApi | null): void {
  readHook = next;
}

/** Softs `SoftsWorld.dixie` after M4.4 lands. Null when no companion is live. */
export function getDixieReadApi(): DixieReadApi | null {
  return readHook;
}

export function asDixieReadApi(
  host: { read(ice: IceModel | null): boolean } | null | undefined,
): DixieReadApi | null {
  if (!host) return null;
  return { read: (ice) => host.read(ice) };
}

export function asAskDixie(
  host:
    | {
        askRead(): boolean;
        read(ice: IceModel | null): boolean;
        readCooldown: number;
        reading: number;
      }
    | null
    | undefined,
): AskDixie | null {
  if (!host) return null;
  return {
    read: (ice) => host.read(ice),
    ask: () => host.askRead(),
    get cooldown() {
      return host.readCooldown;
    },
    get reading() {
      return host.reading;
    },
  };
}

export function getAskDixieHook(): AskDixie | null {
  return readHook && 'ask' in readHook ? (readHook as AskDixie) : null;
}

export function setAskDixieHook(next: AskDixie | null): void {
  readHook = next;
}

export interface DixieVoiceSink {
  bark(lineId: string): void;
  laugh(): void;
}

export interface DixieOptions {
  events: EventBus;
  save?: SaveStore;
  voice?: DixieVoiceSink | null;
  /** Current ICE a:b, or null if none is engaged. */
  iceRatio?: () => readonly [number, number] | null;
  /** Act II construct is slotted. Lab sets true. */
  aboard?: boolean;
  /** Deck prompt sink (erase is a system line, not `DIXIE>`). */
  onDeckPrompt?: (text: string) => void;
}

export interface Dixie {
  readonly aboard: boolean;
  readonly t: number;
  readonly speaking: boolean;
  readonly lastLine: string;
  readonly lastLineId: string;
  readonly readCooldown: number;
  readonly reading: number;
  readonly autoHold: boolean;
  readonly flipped: boolean;
  /** 0.5 while flipped with auto-hold on, else 1. Apply to IceModel.lockDecayScale. */
  readonly lockDecayScale: number;
  readonly erasePrompt: boolean;
  readonly erased: boolean | null;
  readonly heardFlatlines: number;
  setAboard(on: boolean): void;
  setAutoHold(on: boolean): void;
  toggleAutoHold(): boolean;
  setFlipped(on: boolean): void;
  /** H / DixieReadApi. Starts the 4 s read from the given ICE (or iceRatio). */
  read(ice: IceModel | null): boolean;
  /** Lab / `H` without a SoftsWorld. Uses `iceRatio`. */
  askRead(): boolean;
  startErase(): void;
  answerErase(yes: boolean): boolean;
  say(line: BarkLine): boolean;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Event-driven companion. Rate-limits non-critical barks to ≤ 1 / 12 s and
 * never overlaps speech. Owns the `H` read; auto-hold during simstim; flatline
 * commentary; erase prompt.
 */
export function createDixie(opts: DixieOptions): Dixie {
  const events = opts.events;
  const save = opts.save;
  const voice = opts.voice ?? null;
  const iceRatio = opts.iceRatio;
  const onDeckPrompt = opts.onDeckPrompt;
  let boundIce: IceModel | null = null;

  const currentRatio = (): readonly [number, number] | null => {
    if (boundIce) return boundIce.state.current.ratio;
    return iceRatio?.() ?? null;
  };

  const gate: BarkGate = createBarkGate();
  let aboard = opts.aboard ?? true;
  let autoHold = true;
  let flipped = false;
  let readCooldown = 0;
  let readDue = -1;
  let lastLine = '';
  let lastLineId = '';
  let erasePrompt = false;
  let erased: boolean | null = save?.data.campaign.dixieErased ?? null;
  let heardFlatlines = save?.data.campaign.flatlines ?? 0;
  let pending: BarkLine | null = null;
  const unsubs: Unsubscribe[] = [];

  const play = (line: BarkLine): void => {
    lastLine = line.text;
    lastLineId = line.id;
    markBarkStarted(gate, barkOccupancy(line.text), line.critical);
    events.post({ type: 'dixieSay', lineId: line.text });
    voice?.bark(line.id);
    if (line.laugh) voice?.laugh();
  };

  const trySay = (line: BarkLine): boolean => {
    if (!aboard) return false;
    if (!canStartBark(gate, line.critical)) {
      if (line.critical && !pending) pending = line;
      return false;
    }
    play(line);
    return true;
  };

  const api: Dixie = {
    get aboard() {
      return aboard;
    },
    get t() {
      return gate.t;
    },
    get speaking() {
      return isSpeaking(gate);
    },
    get lastLine() {
      return lastLine;
    },
    get lastLineId() {
      return lastLineId;
    },
    get readCooldown() {
      return readCooldown;
    },
    get reading() {
      return readDue >= 0 ? Math.max(0, readDue - gate.t) : 0;
    },
    get autoHold() {
      return autoHold;
    },
    get flipped() {
      return flipped;
    },
    get lockDecayScale() {
      return flipped && autoHold ? AUTO_HOLD_DECAY : 1;
    },
    get erasePrompt() {
      return erasePrompt;
    },
    get erased() {
      return erased;
    },
    get heardFlatlines() {
      return heardFlatlines;
    },
    setAboard(on) {
      aboard = on;
    },
    setAutoHold(on) {
      autoHold = on;
    },
    toggleAutoHold() {
      autoHold = !autoHold;
      return autoHold;
    },
    setFlipped(on) {
      flipped = on;
    },
    read(ice) {
      if (!ice) return false;
      boundIce = ice;
      return api.askRead();
    },
    askRead() {
      if (!aboard || readCooldown > 0 || readDue >= 0) return false;
      if (!currentRatio()) return false;
      readDue = gate.t + READ_DELAY_S;
      readCooldown = READ_COOLDOWN_S;
      return true;
    },
    startErase() {
      if (!aboard || erasePrompt) return;
      erasePrompt = true;
      onDeckPrompt?.(ERASE_PROMPT);
    },
    answerErase(yes) {
      if (!erasePrompt) return false;
      erasePrompt = false;
      erased = yes;
      if (save) {
        save.data.campaign.dixieErased = yes;
        save.commit();
      }
      trySay(yes ? eraseYesBark() : eraseNoBark());
      return true;
    },
    say: trySay,
    update(dt) {
      const step = Math.max(0, dt);
      gate.t += step;
      if (readCooldown > 0) readCooldown = Math.max(0, readCooldown - step);

      if (readDue >= 0 && gate.t >= readDue) {
        readDue = -1;
        const ratio = currentRatio();
        if (ratio) trySay(readResultBark(ratio[0], ratio[1]));
      }

      if (pending && canStartBark(gate, true)) {
        const next = pending;
        pending = null;
        play(next);
      }
    },
    dispose() {
      for (const off of unsubs) off();
      unsubs.length = 0;
      if (getDixieReadApi() === hook) setDixieReadApi(null);
    },
  };

  const hook = asAskDixie(api)!;
  setDixieReadApi(hook);

  unsubs.push(
    events.on('iceEngaged', () => {
      trySay(iceEngagedBark());
    }),
  );
  unsubs.push(
    events.on('iceRekeyTelegraph', () => {
      trySay(iceTelegraphBark());
    }),
  );
  unsubs.push(
    events.on('iceRekey', () => {
      trySay(iceRekeyBark());
    }),
  );
  unsubs.push(
    events.on('iceLayerCracked', () => {
      trySay(iceCrackedBark());
    }),
  );
  unsubs.push(
    events.on('gripStart', () => {
      trySay(gripStartBark());
    }),
  );
  unsubs.push(
    events.on('gripEnd', () => {
      trySay(gripEndBark());
    }),
  );
  unsubs.push(
    events.on('simstimFlip', (e) => {
      flipped = e.on;
      if (e.on) trySay(simstimHoldBark());
    }),
  );
  unsubs.push(
    events.on('flatline', (e) => {
      const stored = save?.data.campaign.flatlines ?? 0;
      if (e.scripted) {
        trySay(flatlineBark(Math.max(1, stored || heardFlatlines || 1)));
        return;
      }
      heardFlatlines = Math.max(heardFlatlines + 1, stored);
      trySay(flatlineBark(heardFlatlines));
    }),
  );

  return api;
}
