import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import { createSimstimMode } from '../app/modes/Simstim';
import type { Mode, ModeContext, ModeStack } from '../app/ModeStack';
import { LAB_GATE, labSimstimTimeline } from '../content/simstim/labTimeline';
import type { InputFrame } from '../input/Input';
import { createSimstimRenderer } from '../render/simstim/SimstimRenderer';
import type { Renderer } from '../render/Renderer';
import type { SimstimFeed } from '../simstim/SimstimFeed';

export interface SimstimLab {
  update(dt: number): void;
  dispose(): void;
}

const REKEY_EVERY = 1.6;
const ICE = LAB_GATE.iceNode;

/**
 * `?lab=simstim` — procedural I, Robot lobby through RasterCrtPass, plus the
 * feed FSM (flip/peek/lag, gates, wait exposure, pain echo). Matrix stub keeps
 * simulating (re-keys) while flipped.
 */
export function installSimstimLab(
  renderer: Renderer,
  feed: SimstimFeed,
  modes: ModeStack,
): SimstimLab {
  const view = createSimstimRenderer(renderer);
  const def = labSimstimTimeline();
  feed.load(def, [LAB_GATE]);
  view.load(def);

  const simstimMode = createSimstimMode(feed, view);
  let rekeyAcc = 0;
  let rekeys = 0;
  let ctxRef: ModeContext | null = null;

  const cubeGeom = new BoxGeometry(0.6, 0.6, 0.6);
  const cubeMat = new MeshBasicMaterial({ color: 0x14c77a, toneMapped: false });
  const marker = new Mesh(cubeGeom, cubeMat);
  marker.position.set(2, 0.4, -1);
  renderer.scenes.matrix.add(marker);

  const matrix: Mode = {
    id: 'matrix',
    simulatesWhenCovered: true,
    enter(ctx) {
      ctxRef = ctx;
    },
    exit() {
      ctxRef = null;
    },
    update(dt) {
      rekeyAcc += dt;
      if (rekeyAcc >= REKEY_EVERY) {
        rekeyAcc -= REKEY_EVERY;
        rekeys += 1;
        ctxRef?.events.post({ type: 'iceRekey', iceId: ICE });
      }
      marker.rotation.y += dt * 0.7;
    },
    render() {},
    handleInput(frame: InputFrame) {
      const was = feed.flipped;
      feed.handleInput(frame);
      if (!was && feed.flipped) ctxRef?.modes.push(simstimMode);
      if (frame.pressed('scan')) feed.crack(ICE);
      if (frame.pressed('soft1')) feed.pain.hurt(0.85);
    },
  };

  modes.push(matrix);

  const hint = document.createElement('div');
  hint.dataset.testid = 'simstim-lab';
  hint.style.cssText = [
    'position:absolute',
    'left:12px',
    'top:12px',
    'z-index:2',
    'font:12px/1.45 ui-monospace,monospace',
    'color:#c8d0d8',
    'background:rgba(0,0,0,0.58)',
    'padding:8px 10px',
    'pointer-events:none',
    'max-width:360px',
  ].join(';');
  renderer.canvas.parentElement?.appendChild(hint);

  const syncHint = (): void => {
    const d = feed.debug;
    const gate = feed.gates.get(LAB_GATE.id);
    hint.innerHTML =
      `<div>M6.1 Simstim feed</div>` +
      `<div style="opacity:.75">T flip/peek · F crack gate · 1 pain</div>` +
      `<div data-clock="${d.clock}">clock ${d.clock}  meat ${d.meatTime.toFixed(2)}</div>` +
      `<div>flip ${d.flipped ? 1 : 0} peek ${d.peeking ? 1 : 0} lag ${d.lag.toFixed(2)}</div>` +
      `<div data-gate="${gate?.state ?? 'idle'}">gate ${gate?.state ?? 'idle'}  exp ${(gate?.exposure ?? 0).toFixed(2)}</div>` +
      `<div data-rekeys="${d.rekeysWhileFlipped}">rekeys-while-flipped ${d.rekeysWhileFlipped}  (total ${rekeys})</div>` +
      `<div>pain ${d.pain.toFixed(2)}  neural ${d.neural.toFixed(1)}</div>` +
      `<div style="opacity:.8">${d.line || '—'}</div>`;
  };

  return {
    update() {
      view.apply(feed.sample(), feed.overlay, feed.meatTime);
      const root = renderer.canvas.parentElement;
      if (root) {
        root.dataset.flipped = feed.flipped ? '1' : '0';
        root.dataset.clock = feed.debug.clock;
        root.dataset.gate = feed.gates.get(LAB_GATE.id)?.state ?? 'idle';
        root.dataset.rekeys = String(feed.debug.rekeysWhileFlipped);
        root.dataset.meat = feed.debug.meatTime.toFixed(2);
        root.dataset.exposure = (feed.gates.get(LAB_GATE.id)?.exposure ?? 0).toFixed(3);
        root.dataset.pain = feed.debug.pain.toFixed(2);
        root.dataset.waiting = feed.debug.waiting ? '1' : '0';
      }
      syncHint();
    },
    dispose() {
      view.dispose();
      renderer.scenes.matrix.remove(marker);
      cubeGeom.dispose();
      cubeMat.dispose();
      hint.remove();
    },
  };
}
