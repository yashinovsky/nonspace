/**
 * Ono-Sendai deck overlay (plan §6.3). Vector faceplate + bitmap CRT window.
 * Opens on Tab without pausing the sim. Coordinate entry uses text capture.
 */

import { SOFTS } from '../content/softs';
import type { EventBus, Unsubscribe } from '../core/events';
import type { CampaignState } from '../core/save';
import type { InputFrame, InputService } from '../input/Input';
import { formatMatrixCoord, parseMatrixCoord, type MatrixCoord } from '../world/coords';
import type { Mode, ModeContext } from '../app/ModeStack';
import { el, ensureCrtStyles } from './dom/theme';

export const DECK_TABS = ['COORD', 'SOFTS', 'LOG', 'PING', 'STATUS'] as const;
export type DeckTab = (typeof DECK_TABS)[number];

export interface AddressEntry {
  name: string;
  coord: string;
  id?: string;
}

/** Build the COORD address book from landmark-like records (M2.6). */
export function addressBookFromLandmarks(
  entries: readonly { id?: string; name: string; coords: MatrixCoord }[],
): AddressEntry[] {
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    coord: formatMatrixCoord(e.coords),
  }));
}

/** Live book: authored landmark coords (plan §3.4). M2.6 owns this list. */
export const DEFAULT_ADDRESS_BOOK: readonly AddressEntry[] = addressBookFromLandmarks([
  { id: 'sense-net', name: 'Sense/Net', coords: { region: 'BAMA', x: 168.25, z: 96.4, y: 420 } },
  { id: 'esfa', name: 'ESFA', coords: { region: 'BAMA', x: 160.5, z: 100, y: 520 } },
  {
    id: 'mitsubishi-boa',
    name: 'Mitsubishi BoA',
    coords: { region: 'BAMA', x: 172, z: 94.1, y: 380 },
  },
  { id: 'chiba-node', name: 'Chiba node', coords: { region: 'CHBA', x: 412.9, z: 180.2, y: 160 } },
  { id: 'hosaka', name: 'Hosaka', coords: { region: 'CHBA', x: 408, z: 176.5, y: 640 } },
  { id: 'ninsei', name: 'Ninsei', coords: { region: 'CHBA', x: 410.2, z: 178.4, y: 90 } },
  { id: 'chatsubo', name: 'Chatsubo', coords: { region: 'CHBA', x: 411.5, z: 179.1, y: 40 } },
  {
    id: 'cheap-hotel',
    name: 'Cheap Hotel',
    coords: { region: 'CHBA', x: 413.4, z: 181.0, y: 55 },
  },
  { id: 'ta-berne', name: 'T-A Berne', coords: { region: 'EURO', x: 246.4, z: 74.8, y: 3200 } },
  {
    id: 'turing-geneva',
    name: 'Turing Geneva',
    coords: { region: 'EURO', x: 248, z: 72, y: 1800 },
  },
  {
    id: 'hosaka-m3',
    name: 'Hosaka node (M3)',
    coords: { region: 'BAMA', x: 180.12, z: 102.4, y: 280 },
  },
  {
    id: 'ta-straylight',
    name: 'Villa Straylight',
    coords: { region: 'ORBT', x: 320, z: 40, y: 5600 },
  },
]);

export function hashMarks(n: number): string {
  if (!(n > 0)) return 'NONE';
  return '|'.repeat(Math.min(24, Math.floor(n)));
}

export interface DeckPanel {
  readonly open: boolean;
  readonly tab: DeckTab;
  readonly capturing: boolean;
  readonly coordValue: string;
  readonly lastJump: MatrixCoord | null;
  readonly lastError: string | null;
  readonly log: readonly string[];
  readonly inRun: boolean;
  readonly link: boolean;
  readonly addressBook: readonly AddressEntry[];
  setTab(tab: DeckTab): void;
  setInRun(on: boolean): void;
  setLink(on: boolean): void;
  setAddressBook(entries: readonly AddressEntry[]): void;
  addAddress(entry: AddressEntry): void;
  pushLog(line: string): void;
  show(): void;
  hide(): void;
  toggle(): void;
  mount(parent: HTMLElement): void;
  unmount(): void;
  handleInput(frame: InputFrame): void;
  dispose(): void;
}

export interface DeckPanelOptions {
  input?: InputService;
  events?: EventBus;
  campaign?: () => CampaignState;
  addressBook?: readonly AddressEntry[];
  /**
   * Called with a parsed coord on Enter. Return `false` / an error string to
   * keep the deck open (blocked jump). M2.6 wires CoordinateJump here.
   */
  onJump?: (coord: MatrixCoord) => void | boolean | string;
  onError?: () => void;
  /** Esc while the deck is open (settings). */
  onSettings?: () => void;
  /** Deck closed via Tab / explicit hide. */
  onClose?: () => void;
}

export function createDeckPanel(opts: DeckPanelOptions = {}): DeckPanel {
  ensureCrtStyles();
  const book: AddressEntry[] = [...(opts.addressBook ?? DEFAULT_ADDRESS_BOOK)];
  let root: HTMLElement | null = null;
  let screen: HTMLElement | null = null;
  let tabRow: HTMLElement | null = null;
  let open = false;
  let tab: DeckTab = 'COORD';
  let coordValue = '';
  let lastJump: MatrixCoord | null = null;
  let lastError: string | null = null;
  let inRun = false;
  let link = false;
  const log: string[] = [];
  const unsubs: Unsubscribe[] = [];
  let mounted = false;

  const capturing = (): boolean => opts.input?.capturingText === true;

  const startCapture = (value = coordValue): void => {
    if (!opts.input || tab !== 'COORD' || !open) return;
    coordValue = value;
    opts.input.beginTextCapture({ value, maxLength: 48 });
  };

  const stopCapture = (): void => {
    if (opts.input?.capturingText) coordValue = opts.input.endTextCapture();
  };

  const submitCoord = (raw: string): boolean => {
    const parsed = parseMatrixCoord(raw);
    if (!parsed) {
      lastError = 'BAD COORD';
      lastJump = null;
      opts.onError?.();
      paint();
      return false;
    }
    const result = opts.onJump?.(parsed);
    if (result === false || typeof result === 'string') {
      lastJump = null;
      lastError = typeof result === 'string' ? result : 'BLOCKED';
      opts.onError?.();
      paint();
      return false;
    }
    lastError = null;
    lastJump = parsed;
    panel.pushLog(`JUMP  ${formatMatrixCoord(parsed)}`);
    paint();
    return true;
  };

  const paintTabs = (): void => {
    if (!tabRow) return;
    for (const btn of tabRow.querySelectorAll<HTMLButtonElement>('.ns-tab')) {
      btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
    }
  };

  const paint = (): void => {
    if (!screen) return;
    screen.replaceChildren();
    if (tab === 'COORD') paintCoord(screen);
    else if (tab === 'SOFTS') paintSofts(screen);
    else if (tab === 'LOG') paintLog(screen);
    else if (tab === 'PING') paintPing(screen);
    else paintStatus(screen);
    paintTabs();
    if (root) {
      root.dataset.tab = tab;
      root.dataset.open = open ? '1' : '0';
      root.dataset.capturing = capturing() ? '1' : '0';
    }
  };

  const paintCoord = (host: HTMLElement): void => {
    const shown = capturing() ? (opts.input?.frame.textValue ?? coordValue) : coordValue;
    const cursor = capturing() ? '_' : '';
    host.appendChild(
      el('div', { class: 'ns-row', 'data-testid': 'deck-coord-line' }, `COORD> ${shown}${cursor}`),
    );
    if (lastError)
      host.appendChild(
        el('div', { class: 'ns-err', 'data-testid': 'deck-coord-error' }, lastError),
      );
    if (lastJump) {
      host.appendChild(
        el(
          'div',
          { class: 'ns-muted', 'data-testid': 'deck-coord-jump' },
          `OK  ${formatMatrixCoord(lastJump)}`,
        ),
      );
    }
    host.appendChild(el('div', { class: 'ns-legend' }, 'ADDRESS BOOK'));
    for (const entry of book) {
      const btn = el(
        'button',
        {
          class: 'ns-btn',
          type: 'button',
          'data-testid': `addr-${entry.id ?? entry.name}`,
          'data-addr': entry.id ?? entry.name,
        },
        `${entry.name}  ${entry.coord}`,
      );
      btn.addEventListener('click', () => {
        lastError = null;
        startCapture(entry.coord);
        paint();
      });
      btn.addEventListener('dblclick', () => {
        startCapture(entry.coord);
        submitCoord(entry.coord);
      });
      host.appendChild(btn);
      host.appendChild(document.createTextNode(' '));
    }
    host.appendChild(
      el('div', { class: 'ns-muted' }, 'TYPE COORDINATES  ENTER TO JUMP  ESC CANCELS CAPTURE'),
    );
  };

  const paintSofts = (host: HTMLElement): void => {
    const campaign = opts.campaign?.();
    const slotted = campaign?.softsSlotted ?? ['probe', 'clamp', 'damper'];
    host.appendChild(
      el(
        'div',
        { class: 'ns-muted' },
        inRun ? 'SLOTTING LOCKED  (IN RUN)' : 'SLOTTING OPEN  (BETWEEN RUNS)',
      ),
    );
    for (let i = 0; i < 4; i++) {
      const id = slotted[i];
      const def = id ? SOFTS.find((s) => s.id === id) : undefined;
      const label = def ? `[${i + 1}] ${def.name}` : `[${i + 1}] --`;
      host.appendChild(el('div', { class: 'ns-row', 'data-slot': String(i) }, label));
    }
    host.appendChild(el('div', { class: 'ns-legend' }, 'OWNED'));
    for (const s of SOFTS) {
      host.appendChild(
        el(
          'div',
          { class: 'ns-row ns-muted' },
          `${s.name}  ${s.unlock === 'start' ? 'READY' : 'LOCKED ' + s.unlock}`,
        ),
      );
    }
  };

  const paintLog = (host: HTMLElement): void => {
    if (log.length === 0) {
      host.appendChild(el('div', { class: 'ns-muted' }, 'LOG EMPTY'));
      return;
    }
    for (const line of log.slice(-16)) {
      host.appendChild(el('div', { class: 'ns-row' }, line));
    }
  };

  const paintPing = (host: HTMLElement): void => {
    if (!link) {
      host.appendChild(
        el('div', { class: 'ns-muted', 'data-testid': 'deck-ping' }, 'NO SIMSTIM LINK'),
      );
      return;
    }
    host.appendChild(el('div', { 'data-testid': 'deck-ping' }, 'LINK UP  MOLLY'));
    const pings = ['WAIT', 'GO', 'HOLD'];
    for (const p of pings) {
      const btn = el('button', { class: 'ns-btn', type: 'button', 'data-ping': p }, p);
      btn.addEventListener('click', () => {
        panel.pushLog(`PING  ${p}`);
        paint();
      });
      host.appendChild(btn);
      host.appendChild(document.createTextNode(' '));
    }
  };

  const paintStatus = (host: HTMLElement): void => {
    const c = opts.campaign?.();
    const flats = c?.flatlines ?? 0;
    const scars = c?.scars ?? 0;
    const heat = c?.heat ?? 0;
    host.appendChild(el('div', { class: 'ns-row' }, `FLATLINE  ${hashMarks(flats)}`));
    host.appendChild(el('div', { class: 'ns-row' }, `SCARS     ${hashMarks(scars)}`));
    host.appendChild(
      el('div', { class: 'ns-row', 'data-testid': 'deck-heat' }, `HEAT      ${heat.toFixed(0)}`),
    );
  };

  if (opts.events) {
    const bus = opts.events;
    unsubs.push(bus.on('dixieSay', (e) => panel.pushLog(`DIXIE> ${e.lineId}`)));
    unsubs.push(
      bus.on('wintermute', (e) => {
        if (e.action.kind === 'hijack') panel.pushLog(e.action.text);
      }),
    );
    unsubs.push(bus.on('iceRekeyTelegraph', () => panel.pushLog('[REKEY]')));
  }

  const panel: DeckPanel = {
    get open() {
      return open;
    },
    get tab() {
      return tab;
    },
    get capturing() {
      return capturing();
    },
    get coordValue() {
      return capturing() ? (opts.input?.frame.textValue ?? coordValue) : coordValue;
    },
    get lastJump() {
      return lastJump;
    },
    get lastError() {
      return lastError;
    },
    get log() {
      return log;
    },
    get inRun() {
      return inRun;
    },
    get link() {
      return link;
    },
    get addressBook() {
      return book;
    },
    setTab(next) {
      if (next === tab) return;
      if (tab === 'COORD') stopCapture();
      tab = next;
      if (next === 'COORD' && open) startCapture(coordValue);
      paint();
    },
    setInRun(on) {
      inRun = on;
      if (open && tab === 'SOFTS') paint();
    },
    setLink(on) {
      link = on;
      if (open && tab === 'PING') paint();
    },
    setAddressBook(entries) {
      book.length = 0;
      book.push(...entries);
      if (open && tab === 'COORD') paint();
    },
    addAddress(entry) {
      if (book.some((e) => e.coord === entry.coord && e.name === entry.name)) return;
      book.push(entry);
      if (open && tab === 'COORD') paint();
    },
    pushLog(line) {
      log.push(line);
      if (log.length > 64) log.shift();
      if (open && tab === 'LOG') paint();
    },
    show() {
      open = true;
      if (root) {
        root.hidden = false;
        root.dataset.open = '1';
      }
      if (tab === 'COORD') startCapture(coordValue);
      paint();
    },
    hide() {
      if (tab === 'COORD') stopCapture();
      open = false;
      if (root) {
        root.hidden = true;
        root.dataset.open = '0';
        root.dataset.capturing = '0';
      }
      opts.onClose?.();
    },
    toggle() {
      if (open) panel.hide();
      else panel.show();
    },
    mount(parent) {
      if (mounted) return;
      ensureCrtStyles();
      root = el('div', {
        class: 'ns-crt-root',
        'data-testid': 'deck-panel',
        hidden: 'true',
        'data-open': '0',
      });
      const dim = el('div', { class: 'ns-dim' });
      const plate = el('div', {
        class: 'ns-faceplate',
        role: 'dialog',
        'aria-label': 'Deck panel',
      });
      const mast = el('div', { class: 'ns-mast' });
      mast.append(
        el('span', { class: 'ns-logo' }, 'ONO-SENDAI'),
        el('span', { class: 'ns-model' }, 'CYBERSPACE 7'),
      );
      tabRow = el('div', { class: 'ns-tabs', role: 'tablist' });
      for (const id of DECK_TABS) {
        const btn = el(
          'button',
          {
            class: 'ns-tab',
            type: 'button',
            role: 'tab',
            'data-tab': id,
            'data-testid': `deck-tab-${id}`,
          },
          id,
        );
        btn.addEventListener('click', () => panel.setTab(id));
        tabRow.appendChild(btn);
      }
      screen = el('div', { class: 'ns-crt', 'data-testid': 'deck-crt' });
      plate.append(mast, tabRow, screen, el('div', { class: 'ns-plate-corners' }));
      root.append(dim, plate);
      parent.appendChild(root);
      mounted = true;
      paint();
    },
    unmount() {
      stopCapture();
      root?.remove();
      root = null;
      screen = null;
      tabRow = null;
      mounted = false;
      open = false;
    },
    handleInput(frame) {
      if (!open) return;
      if (frame.pressed('deck')) {
        panel.hide();
        return;
      }
      if (frame.pressed('pause') && !capturing()) {
        opts.onSettings?.();
        return;
      }
      if (tab === 'COORD' && capturing()) {
        coordValue = frame.textValue;
        if (frame.textEnter) submitCoord(frame.textValue);
        if (frame.textEscape) stopCapture();
        paint();
        return;
      }
      if (frame.pressed('soft1')) panel.setTab('COORD');
      else if (frame.pressed('soft2')) panel.setTab('SOFTS');
      else if (frame.pressed('soft3')) panel.setTab('LOG');
      else if (frame.pressed('soft4')) panel.setTab('PING');
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      panel.unmount();
    },
  };
  return panel;
}

export interface DeckPanelMode extends Mode {
  readonly panel: DeckPanel;
}

export function createDeckPanelMode(opts: DeckPanelOptions = {}): DeckPanelMode {
  const panel = createDeckPanel(opts);
  let ctx: ModeContext | null = null;
  const mode: DeckPanelMode = {
    id: 'deckPanel',
    simulatesWhenCovered: false,
    panel,
    enter(next) {
      ctx = next;
      const parent =
        next.renderer?.canvas.parentElement ??
        (typeof document !== 'undefined' ? document.body : null);
      if (parent) panel.mount(parent);
      panel.show();
    },
    exit() {
      panel.hide();
      panel.unmount();
      ctx = null;
    },
    update() {},
    render() {},
    handleInput(frame) {
      panel.handleInput(frame);
      if (!panel.open) ctx?.modes.pop();
    },
  };
  return mode;
}
