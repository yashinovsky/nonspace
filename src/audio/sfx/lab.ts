import { createAudioEngine, getAudioDiagnostics, getAudioEngineHandle } from '../AudioEngine';
import type { AudioDiagnostics, AudioEngine, EngineLabHandle, SfxId } from '../AudioEngine';
import { createEventBus } from '../../core/events';
import { bindSfxToEvents } from './bind';
import { EXTRA_SFX_IDS, SFX_PALETTE } from './palette';
import { FLATLINE_TIMING, flatlinePhaseAt, type FlatlinePhase } from './recipes/flatline';

export interface SfxLabHandle {
  engine: AudioEngine;
  lab: EngineLabHandle;
  diagnostics(): AudioDiagnostics | null;
}

declare global {
  interface Window {
    __nonspaceSfx?: SfxLabHandle;
  }
}

export async function startSfxLab(root: HTMLElement): Promise<SfxLabHandle> {
  document.title = 'NONSPACE sfx lab';
  root.replaceChildren();
  root.dataset.status = 'sfx-lab';

  const engine = createAudioEngine();
  const lab = getAudioEngineHandle(engine);
  if (!lab) throw new Error('sfx lab: real engine handle missing');

  const bus = createEventBus();
  let unbind: (() => void) | null = null;

  const style = document.createElement('style');
  style.textContent = `
    .sfx-lab { position:fixed; inset:0; overflow:auto; background:#000; color:#a8d8ff;
      font:14px/1.45 ui-monospace, Menlo, Consolas, monospace; padding:1.5rem 1.75rem 3rem; }
    .sfx-lab h1 { font-size:1.05rem; letter-spacing:0.32em; margin:0 0 0.35rem; font-weight:600; }
    .sfx-lab .sub { color:#6a8aaa; margin:0 0 1.25rem; }
    .sfx-lab kbd { border:1px solid #2a4a66; padding:0 0.3em; color:#ffb000; }
    .sfx-lab .row { display:flex; flex-wrap:wrap; gap:0.45rem; margin:0 0 0.85rem; }
    .sfx-lab section { margin:0 0 1.1rem; }
    .sfx-lab h2 { font-size:0.72rem; letter-spacing:0.18em; color:#6a8aaa; margin:0 0 0.4rem; font-weight:500; }
    .sfx-lab button { background:#071018; color:#a8d8ff; border:1px solid #2a4a66; padding:0.4rem 0.7rem;
      font:inherit; cursor:pointer; }
    .sfx-lab button:hover, .sfx-lab button.on { border-color:#ffb000; color:#ffb000; }
    .sfx-lab .gate { margin:0 0 1rem; color:#ffb000; }
    .sfx-lab canvas { display:block; width:min(640px,100%); height:160px; background:#02060a;
      border:1px solid #1a3348; image-rendering:pixelated; }
    .sfx-lab .phase { color:#ffb000; margin:0.35rem 0 0; min-height:1.2em; }
    .sfx-lab pre { background:#071018; border:1px solid #1a3348; padding:0.75rem 0.9rem; overflow:auto;
      color:#c8e4ff; font-size:12px; max-width:52rem; }
  `;
  root.appendChild(style);

  const page = document.createElement('main');
  page.className = 'sfx-lab';

  const paletteButtons = SFX_PALETTE.map(
    (row) =>
      `<button type="button" data-testid="sfx-${row.id}" data-sfx="${row.id}">${row.recipe}</button>`,
  ).join('');
  const extraButtons = EXTRA_SFX_IDS.map(
    (id) => `<button type="button" data-testid="sfx-${id}" data-sfx="${id}">${id}</button>`,
  ).join('');

  page.innerHTML = `
    <h1>NONSPACE</h1>
    <p class="sub">SFX catalog lab · M5.2 · <kbd>?lab=sfx</kbd></p>
    <p class="gate" data-testid="sfx-gate">Click anywhere (or Unlock) to start the AudioContext.</p>
    <section>
      <h2>ENGINE</h2>
      <div class="row">
        <button type="button" data-testid="sfx-unlock">Unlock</button>
      </div>
    </section>
    <section>
      <h2>PALETTE §7.3</h2>
      <div class="row">${paletteButtons}</div>
    </section>
    <section>
      <h2>EXTRA SFX IDS</h2>
      <div class="row">${extraButtons}</div>
    </section>
    <section>
      <h2>MODEM §7.4</h2>
      <div class="row">
        <button type="button" data-testid="sfx-modem-start">Modem start (Bell 103 FSK)</button>
        <button type="button" data-testid="sfx-modem-stop">Modem stop</button>
      </div>
    </section>
    <section>
      <h2>DIXIE §7.5</h2>
      <div class="row">
        <button type="button" data-testid="sfx-dixie-bark">Bark</button>
        <button type="button" data-testid="sfx-dixie-laugh">Laugh</button>
      </div>
    </section>
    <section>
      <h2>FLATLINE (event-driven, timed to visual stub)</h2>
      <div class="row">
        <button type="button" data-testid="sfx-event-flatline">Emit flatline event</button>
      </div>
      <canvas data-testid="sfx-flatline-visual" width="640" height="160"></canvas>
      <p class="phase" data-testid="sfx-flatline-phase">phase: idle</p>
    </section>
    <section>
      <h2>DIAGNOSTICS</h2>
      <pre data-testid="sfx-diag">waiting…</pre>
    </section>
  `;
  root.appendChild(page);

  const diagEl = page.querySelector('[data-testid="sfx-diag"]')!;
  const gateEl = page.querySelector('[data-testid="sfx-gate"]') as HTMLElement;
  const phaseEl = page.querySelector('[data-testid="sfx-flatline-phase"]') as HTMLElement;
  const canvas = page.querySelector('[data-testid="sfx-flatline-visual"]') as HTMLCanvasElement;
  const ctx2d = canvas.getContext('2d');
  let flightOn = false;
  let flightTicks = 0;
  let visualT0 = 0;
  let visualActive = false;

  const paintDiag = (): void => {
    const d = lab.diagnostics();
    const extra = {
      flight: lab.flightSpeed(),
      flatline: lab.flatlinePhase(),
      modem: lab.modemInfo(),
    };
    diagEl.textContent = JSON.stringify({ ...d, sfx: extra }, null, 2);
  };

  const afterUnlock = (): void => {
    root.dataset.unlocked = 'true';
    gateEl.textContent = 'AudioContext running. Every §7.3 recipe, Bell 103 modem, Dixie barks.';
    if (!unbind) unbind = bindSfxToEvents(bus, engine, lab.dixie() ?? undefined);
    paintDiag();
  };

  const unlock = async (): Promise<void> => {
    await engine.unlock();
    afterUnlock();
  };

  page.querySelector('[data-testid="sfx-unlock"]')!.addEventListener('click', () => void unlock());
  page.addEventListener(
    'pointerdown',
    () => {
      if (!root.dataset.unlocked) void unlock();
    },
    { capture: true },
  );

  const playId = (id: string): void => {
    void unlock().then(() => {
      if (id === 'flightWind') {
        flightOn = !flightOn;
        lab.setFlight(flightOn ? 0.7 : 0);
        const btn = page.querySelector('[data-sfx="flightWind"]');
        btn?.classList.toggle('on', flightOn);
        if (flightOn && !flightTicks) {
          flightTicks = window.setInterval(() => engine.sfx('gridTick'), 380);
        } else if (!flightOn && flightTicks) {
          window.clearInterval(flightTicks);
          flightTicks = 0;
        }
        return;
      }
      if (id === 'flatline') {
        visualT0 = performance.now() / 1000;
        visualActive = true;
      }
      engine.sfx(id as SfxId);
    });
  };

  page.querySelectorAll<HTMLButtonElement>('[data-sfx]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playId(btn.dataset.sfx ?? '');
      paintDiag();
    });
  });

  page.querySelector('[data-testid="sfx-modem-start"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    void unlock().then(() => engine.modem.start());
  });
  page.querySelector('[data-testid="sfx-modem-stop"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    engine.modem.stop();
  });
  page.querySelector('[data-testid="sfx-dixie-bark"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    void unlock().then(() => lab.dixie()?.bark('lab-line'));
  });
  page.querySelector('[data-testid="sfx-dixie-laugh"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    void unlock().then(() => lab.dixie()?.laugh());
  });
  page.querySelector('[data-testid="sfx-event-flatline"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    void unlock().then(() => {
      visualT0 = performance.now() / 1000;
      visualActive = true;
      bus.emit({ type: 'flatline', scripted: true });
    });
  });

  const drawVisual = (phase: FlatlinePhase, elapsed: number): void => {
    if (!ctx2d) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.fillStyle = '#02060a';
    ctx2d.fillRect(0, 0, w, h);
    const T = FLATLINE_TIMING;
    if (phase === 'idle' || phase === 'done') {
      ctx2d.strokeStyle = '#123';
      ctx2d.beginPath();
      ctx2d.moveTo(8, h * 0.5);
      ctx2d.lineTo(w - 8, h * 0.5);
      ctx2d.stroke();
      return;
    }
    if (phase === 'silence') {
      ctx2d.strokeStyle = '#143214';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(8, h * 0.5);
      ctx2d.lineTo(w - 8, h * 0.5);
      ctx2d.stroke();
      return;
    }
    const collapseT = Math.max(0, elapsed - T.collapseStart);
    let scaleY = 1;
    let scaleX = 1;
    if (phase === 'tone') {
      scaleY = Math.max(0.02, 1 - collapseT / T.collapseDur);
    } else if (phase === 'linger') {
      scaleY = 0.02;
      scaleX = 0.02;
    }
    ctx2d.save();
    ctx2d.translate(w / 2, h / 2);
    ctx2d.scale(scaleX, scaleY);
    ctx2d.translate(-w / 2, -h / 2);
    ctx2d.strokeStyle = phase === 'beeps' ? '#7fef9a' : '#c8ffd0';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    const mid = h * 0.5;
    for (let x = 8; x < w - 8; x++) {
      const n =
        phase === 'beeps'
          ? Math.sin(x * 0.18 + elapsed * 14) * (18 * (1 - elapsed / T.toneStart))
          : 0;
      const y = mid + n;
      if (x === 8) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.restore();
    if (phase === 'linger') {
      ctx2d.fillStyle = '#e8ffe8';
      ctx2d.fillRect(w / 2 - 2, h / 2 - 2, 4, 4);
    }
  };

  const tick = (): void => {
    const elapsed = visualActive ? performance.now() / 1000 - visualT0 : -1;
    const phase = elapsed < 0 ? 'idle' : flatlinePhaseAt(elapsed);
    if (phase === 'done') visualActive = false;
    phaseEl.textContent = `phase: ${phase}${elapsed >= 0 ? `  t=${elapsed.toFixed(2)}s` : ''}`;
    root.dataset.flatlinePhase = phase;
    drawVisual(phase, elapsed);
    paintDiag();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const handle: SfxLabHandle = {
    engine,
    lab,
    diagnostics: () => getAudioDiagnostics(engine),
  };
  window.__nonspaceSfx = handle;
  return handle;
}
