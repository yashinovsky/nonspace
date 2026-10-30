import { createAudioEngine, getAudioDiagnostics, getAudioEngineHandle } from './AudioEngine';
import type { AudioDiagnostics, AudioEngine, EngineLabHandle, Handle } from './AudioEngine';

export interface AudioLabHandle {
  engine: AudioEngine;
  lab: EngineLabHandle;
  diagnostics(): AudioDiagnostics | null;
}

declare global {
  interface Window {
    __nonspaceAudio?: AudioLabHandle;
  }
}

export async function startAudioLab(root: HTMLElement): Promise<AudioLabHandle> {
  document.title = 'NONSPACE audio lab';
  root.replaceChildren();
  root.dataset.status = 'audio-lab';

  const engine = createAudioEngine();
  const lab = getAudioEngineHandle(engine);
  if (!lab) throw new Error('audio lab: real engine handle missing');

  const style = document.createElement('style');
  style.textContent = `
    .audio-lab { position:fixed; inset:0; overflow:auto; background:#000; color:#a8d8ff;
      font:14px/1.45 ui-monospace, Menlo, Consolas, monospace; padding:1.5rem 1.75rem 3rem; }
    .audio-lab h1 { font-size:1.05rem; letter-spacing:0.32em; margin:0 0 0.35rem; font-weight:600; }
    .audio-lab .sub { color:#6a8aaa; margin:0 0 1.25rem; }
    .audio-lab kbd { border:1px solid #2a4a66; padding:0 0.3em; color:#ffb000; }
    .audio-lab .row { display:flex; flex-wrap:wrap; gap:0.45rem; margin:0 0 0.85rem; }
    .audio-lab section { margin:0 0 1.1rem; }
    .audio-lab h2 { font-size:0.72rem; letter-spacing:0.18em; color:#6a8aaa; margin:0 0 0.4rem; font-weight:500; }
    .audio-lab button { background:#071018; color:#a8d8ff; border:1px solid #2a4a66; padding:0.4rem 0.7rem;
      font:inherit; cursor:pointer; }
    .audio-lab button:hover { border-color:#ffb000; color:#ffb000; }
    .audio-lab button:disabled { opacity:0.4; cursor:default; }
    .audio-lab pre { background:#071018; border:1px solid #1a3348; padding:0.75rem 0.9rem; overflow:auto;
      color:#c8e4ff; font-size:12px; max-width:52rem; }
    .audio-lab .gate { margin:0 0 1rem; color:#ffb000; }
  `;
  root.appendChild(style);

  const page = document.createElement('main');
  page.className = 'audio-lab';
  page.innerHTML = `
    <h1>NONSPACE</h1>
    <p class="sub">Audio engine lab · M5.1 / M5.3 · <kbd>?lab=audio</kbd></p>
    <p class="gate" data-testid="audio-gate">Click anywhere (or Unlock) to start the AudioContext.</p>
    <section>
      <h2>ENGINE</h2>
      <div class="row">
        <button type="button" data-testid="audio-unlock">Unlock</button>
        <button type="button" data-testid="audio-stop">Stop voices</button>
      </div>
    </section>
    <section>
      <h2>VOICES</h2>
      <div class="row">
        <button type="button" data-testid="audio-chord">16 FM voices</button>
        <button type="button" data-testid="audio-sub">Sub pad</button>
        <button type="button" data-testid="audio-bass">Bass</button>
        <button type="button" data-testid="audio-kick">Kick</button>
        <button type="button" data-testid="audio-snare">Snare</button>
        <button type="button" data-testid="audio-hat">Hat</button>
      </div>
    </section>
    <section>
      <h2>MIX / SPATIAL</h2>
      <div class="row">
        <button type="button" data-testid="audio-duck-all">Duck all −12 dB / 1s</button>
        <button type="button" data-testid="audio-duck-music">Duck music −24 dB / 2s</button>
        <button type="button" data-testid="audio-motif-attach">Attach motif (HRTF)</button>
        <button type="button" data-testid="audio-motif-orbit">Orbit motif</button>
        <button type="button" data-testid="audio-motif-detach">Detach motif</button>
      </div>
    </section>
    <section>
      <h2>MUSIC (M5.3)</h2>
      <div class="row">
        <button type="button" data-testid="audio-music-transit">Transit</button>
        <button type="button" data-testid="audio-music-approach">Approach</button>
        <button type="button" data-testid="audio-music-breach">Breach</button>
        <button type="button" data-testid="audio-music-grip">Grip</button>
        <button type="button" data-testid="audio-music-core">Core</button>
        <button type="button" data-testid="audio-music-simstim">Simstim</button>
        <button type="button" data-testid="audio-music-kuang">Kuang dive</button>
        <button type="button" data-testid="audio-music-beach">Beach</button>
        <button type="button" data-testid="audio-music-silent">Silent</button>
      </div>
      <p class="sub" data-testid="audio-pulse">pulse —</p>
    </section>
    <section>
      <h2>STUBS (M5.2–M5.4)</h2>
      <div class="row">
        <button type="button" data-testid="audio-sfx">SFX shatter</button>
        <button type="button" data-testid="audio-pl-start">Phase Lock start</button>
        <button type="button" data-testid="audio-pl-stop">Phase Lock stop</button>
        <button type="button" data-testid="audio-modem-start">Modem start</button>
        <button type="button" data-testid="audio-modem-stop">Modem stop</button>
      </div>
    </section>
    <section>
      <h2>DIAGNOSTICS</h2>
      <pre data-testid="audio-diag">waiting…</pre>
    </section>
  `;
  root.appendChild(page);

  const diagEl = page.querySelector('[data-testid="audio-diag"]')!;
  const gateEl = page.querySelector('[data-testid="audio-gate"]') as HTMLElement;
  let motif: Handle | null = null;
  let orbitTimer = 0;
  let orbitT = 0;

  const pulseEl = page.querySelector('[data-testid="audio-pulse"]') as HTMLElement;
  const paint = (): void => {
    const d = lab.diagnostics();
    diagEl.textContent = JSON.stringify(d, null, 2);
    const t = d?.clock ? d.clock.origin + (d.clock.beat * 60) / Math.max(1, d.clock.bpm) : 0;
    pulseEl.textContent = `pulse ${lab.pulse(t).toFixed(3)} · ${d?.music.state ?? 'silent'} @ ${d?.clock.bpm ?? 96} BPM`;
  };

  const afterUnlock = (): void => {
    root.dataset.unlocked = 'true';
    gateEl.textContent =
      'AudioContext running. Buses, worklets, 16 FM voices, HRTF motifs, ducking, adaptive music.';
    paint();
  };

  const unlock = async (): Promise<void> => {
    await engine.unlock();
    afterUnlock();
  };

  page
    .querySelector('[data-testid="audio-unlock"]')!
    .addEventListener('click', () => void unlock());
  page.addEventListener(
    'pointerdown',
    () => {
      if (!root.dataset.unlocked) void unlock();
    },
    { capture: true },
  );

  const on = (testId: string, fn: () => void): void => {
    page.querySelector(`[data-testid="${testId}"]`)!.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      paint();
    });
  };

  on('audio-stop', () => lab.stopVoices());
  on('audio-chord', () => {
    void unlock().then(() => lab.playChord16());
  });
  on('audio-sub', () => {
    void unlock().then(() => lab.noteSub());
  });
  on('audio-bass', () => {
    void unlock().then(() => lab.noteBass());
  });
  on('audio-kick', () => {
    void unlock().then(() => lab.noteDrum('kick'));
  });
  on('audio-snare', () => {
    void unlock().then(() => lab.noteDrum('snare'));
  });
  on('audio-hat', () => {
    void unlock().then(() => lab.noteDrum('hat'));
  });
  on('audio-duck-all', () => {
    void unlock().then(() => engine.duck('all', -12, 1));
  });
  on('audio-duck-music', () => {
    void unlock().then(() => engine.duck('music', -24, 2));
  });
  on('audio-motif-attach', () => {
    void unlock().then(() => {
      if (motif !== null) engine.motif.detach(motif);
      engine.listener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
      motif = engine.motif.attach('lab-ta', { x: 120, y: 0, z: -80 }, 'tessierAshpool');
    });
  });
  on('audio-motif-orbit', () => {
    void unlock().then(() => {
      if (motif === null) {
        engine.listener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
        motif = engine.motif.attach('lab-mitsu', { x: 140, y: 0, z: 0 }, 'mitsubishi');
      }
      if (orbitTimer) window.clearInterval(orbitTimer);
      orbitTimer = window.setInterval(() => {
        if (motif === null) return;
        orbitT += 0.08;
        lab.moveMotif(motif, {
          x: Math.cos(orbitT) * 160,
          y: 0,
          z: Math.sin(orbitT) * 160,
        });
      }, 50);
    });
  });
  const setMusic = (state: Parameters<AudioEngine['music']['setState']>[0]): void => {
    void unlock().then(() => engine.music.setState(state));
  };
  on('audio-music-transit', () => setMusic('transit'));
  on('audio-music-approach', () => setMusic('approach'));
  on('audio-music-breach', () => {
    void unlock().then(() => {
      lab.setLockMeter(0.7);
      engine.music.setState('breach');
    });
  });
  on('audio-music-grip', () => setMusic('grip'));
  on('audio-music-core', () => setMusic('core'));
  on('audio-music-simstim', () => setMusic('simstim'));
  on('audio-music-kuang', () => setMusic('kuangDive'));
  on('audio-music-beach', () => setMusic('beach'));
  on('audio-music-silent', () => setMusic('silent'));
  on('audio-motif-detach', () => {
    if (orbitTimer) {
      window.clearInterval(orbitTimer);
      orbitTimer = 0;
    }
    if (motif !== null) engine.motif.detach(motif);
    motif = null;
  });
  on('audio-sfx', () => {
    void unlock().then(() => engine.sfx('shatter'));
  });
  on('audio-pl-start', () => {
    void unlock().then(() => {
      engine.phaseLock.start(2, 3, 110);
      engine.phaseLock.setPlayer(1.5, 0);
    });
  });
  on('audio-pl-stop', () => engine.phaseLock.stop());
  on('audio-modem-start', () => {
    void unlock().then(() => engine.modem.start());
  });
  on('audio-modem-stop', () => engine.modem.stop());

  paint();
  window.setInterval(paint, 250);

  const handle: AudioLabHandle = {
    engine,
    lab,
    diagnostics: () => getAudioDiagnostics(engine),
  };
  window.__nonspaceAudio = handle;
  return handle;
}
