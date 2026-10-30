import type { DebugPaneLike } from '../../render/Renderer';
import type { Mode, ModeContext } from '../ModeStack';
import { createBeachAudio, type BeachAudio } from '../../render/beach/audio';
import {
  createBeachRenderer,
  type BeachRenderer,
  type BeachView,
} from '../../render/beach/BeachRenderer';
import { createBeachSim, type BeachDebug, type BeachSim } from '../../render/beach/sim';
import { readWalkInput, type WalkPose } from '../../render/beach/walk';
import { MAX_MARCH } from '../../render/beach/world';
import type { InputFrame } from '../../input/Input';

export interface BeachMode extends Mode {
  readonly sim: BeachSim;
  readonly debug: BeachDebug;
  attachDebug(pane: DebugPaneLike): void;
}

export interface BeachModeOptions {
  lab?: boolean;
}

const FLAG_STAY = 'endingB';
const FLAG_LEAVE = 'beachLeft';

export function createBeachMode(opts: BeachModeOptions = {}): BeachMode {
  const sim = createBeachSim();
  const samplePose: WalkPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const view: BeachView = {
    pose: samplePose,
    sunX: 0.22,
    sunY: 0,
    sunZ: -1,
    time: 0,
    reveal: 0,
    stay: 0,
    maxSteps: MAX_MARCH,
    hdr: true,
  };

  let ctx: ModeContext | null = null;
  let beach: BeachRenderer | null = null;
  let audio: BeachAudio | null = null;
  let overlay: HTMLDivElement | null = null;
  let subtitleEl: HTMLDivElement | null = null;
  let creditsEl: HTMLDivElement | null = null;
  let lastSubtitle = '';
  let creditsOn = false;
  let postedChoice: 'stay' | 'leave' | null = null;

  const publishDebug = (): void => {
    const w = window as unknown as { __nonspace?: { beach?: BeachSim } };
    if (w.__nonspace) w.__nonspace.beach = sim;
  };

  const applyChoice = (choice: 'stay' | 'leave'): void => {
    if (postedChoice === choice) return;
    postedChoice = choice;
    const c = ctx;
    if (!c) return;
    c.save.data.campaign.flags[choice === 'stay' ? FLAG_STAY : FLAG_LEAVE] = true;
    c.save.commit();
    c.events.post({ type: 'beachChoice', choice });
    if (choice === 'stay') c.audio?.music.setState('beach');
  };

  const ensureOverlay = (root: HTMLElement): void => {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.dataset.beachUi = '1';
    overlay.style.cssText =
      'position:fixed;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;font-family:ui-sans-serif,system-ui,sans-serif;color:#e6d8c4;';
    subtitleEl = document.createElement('div');
    subtitleEl.dataset.testid = 'beach-subtitle';
    subtitleEl.style.cssText =
      'margin:0 0 8% 0;max-width:42rem;padding:0.4rem 0.8rem;letter-spacing:0.16em;font-size:0.85rem;text-transform:uppercase;text-align:center;background:rgba(12,10,8,0.35);';
    creditsEl = document.createElement('div');
    creditsEl.dataset.testid = 'beach-credits';
    creditsEl.style.cssText =
      'display:none;position:absolute;inset:18% 0 auto 0;text-align:center;letter-spacing:0.42em;font-weight:300;line-height:2.2;';
    creditsEl.innerHTML =
      '<div style="font-size:1.4rem">NONSPACE</div><div style="font-size:0.72rem">you stayed</div>';
    overlay.append(creditsEl, subtitleEl);
    root.appendChild(overlay);
  };

  const showCredits = (on: boolean): void => {
    creditsOn = on;
    if (creditsEl) creditsEl.style.display = on ? 'block' : 'none';
  };

  const paintView = (alpha: number): void => {
    sim.sample(alpha, samplePose);
    view.sunX = sim.sun.x;
    view.sunY = sim.sun.y;
    view.sunZ = sim.sun.z;
    view.time = sim.time;
    view.reveal = sim.reveal;
    view.stay = sim.phase === 'endingB' || sim.phase === 'sitting' ? 1 : 0;
    const r = ctx?.renderer;
    const steps = r?.quality.tier === 'low' ? 40 : r?.quality.tier === 'medium' ? 52 : MAX_MARCH;
    view.maxSteps = steps;
    view.hdr = r?.quality.hdr ?? true;
  };

  const mode: BeachMode = {
    id: 'beach',
    simulatesWhenCovered: false,
    sim,
    debug: sim.debug,
    enter(next) {
      ctx = next;
      const renderer = next.renderer;
      if (!renderer) throw new Error('Beach mode needs ModeContext.renderer');
      beach = createBeachRenderer();
      audio = createBeachAudio();
      renderer.postMode = 'beach';
      renderer.drawHdr = (three, target) => {
        if (!beach) return;
        paintView(1);
        beach.render(three, target, view);
      };
      ensureOverlay(renderer.canvas.parentElement ?? document.body);
      if (opts.lab && overlay) overlay.dataset.lab = 'beach';
      next.audio?.music.setState('beach');
      publishDebug();
    },
    exit() {
      const renderer = ctx?.renderer;
      if (renderer && renderer.drawHdr) renderer.drawHdr = null;
      if (renderer) renderer.postMode = 'matrix';
      beach?.dispose();
      beach = null;
      audio?.dispose();
      audio = null;
      overlay?.remove();
      overlay = null;
      subtitleEl = null;
      creditsEl = null;
      ctx = null;
    },
    handleInput(frame: InputFrame) {
      readWalkInput(frame, sim.input);
      if (frame.pressed('engage')) sim.sitPressed = true;
      if (frame.pointerLocked || frame.pressed('engage') || frame.down('boost')) {
        void audio?.unlock();
        void ctx?.audio?.unlock();
      }
    },
    update(dt) {
      if (ctx?.settings.value.reduceMotion) sim.sunPeriod = 96;
      const pulse = sim.step(dt);
      if (pulse.choice) applyChoice(pulse.choice);
      if (sim.phase === 'endingB') {
        applyChoice('stay');
        showCredits(true);
      }
      if (sim.phase === 'left') applyChoice('leave');
      audio?.listener(sim.walk.pose, sim.walk.forward, sim.walk.up);
      const a = ctx?.settings.value.audio;
      if (a) audio?.setGains(a.master, a.sfx);
      ctx?.audio?.listener(sim.walk.pose, sim.walk.forward, sim.walk.up);
      if (subtitleEl && sim.subtitle !== lastSubtitle) {
        lastSubtitle = sim.subtitle;
        const show = ctx?.settings.value.subtitles.enabled !== false;
        subtitleEl.textContent = show ? sim.subtitle : '';
        subtitleEl.style.opacity = sim.subtitle && show ? '1' : '0';
      }
      if (creditsOn && overlay) overlay.dataset.ending = 'B';
      publishDebug();
    },
    render(alpha) {
      paintView(alpha);
    },
    attachDebug(pane) {
      const folder = pane.addFolder({ title: 'beach' });
      folder.addBinding(sim.debug, 'phase', { readonly: true });
      folder.addBinding(sim.debug, 'reveal', {
        readonly: true,
        format: (n: number) => n.toFixed(2),
      });
      folder.addBinding(sim.debug, 'sunY', {
        readonly: true,
        label: 'sun y',
        format: (n: number) => n.toFixed(2),
      });
      folder.addBinding(sim.debug, 'bassDistance', {
        readonly: true,
        label: 'bass m',
        format: (n: number) => n.toFixed(1),
      });
      folder.addButton({ title: 'sit / ending B' }).on('click', () => {
        const p = sim.forceStay();
        if (p.choice) applyChoice(p.choice);
        showCredits(true);
      });
      folder.addButton({ title: 'walk to exit' }).on('click', () => {
        const p = sim.forceLeave();
        if (p.choice) applyChoice(p.choice);
      });
      folder.addButton({ title: 'look down (checker)' }).on('click', () => {
        sim.walk.pose.pitch = -1.15;
        sim.walk.prev.pitch = -1.15;
        sim.stillness = 1;
      });
    },
  };
  return mode;
}
