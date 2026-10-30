import type { SettingsStore } from '../core/settings';
import {
  ACTIONS,
  AXES,
  formatSource,
  type ActionId,
  type AxisId,
  type InputService,
} from './Input';

const CSS = [
  'position:fixed',
  'inset:0',
  'pointer-events:none',
  'font:13px/1.4 ui-monospace, Menlo, Consolas, monospace',
  'color:#a8d8ff',
  'z-index:20',
  'background:linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0.28) 38%, transparent 55%)',
].join(';');

const PANEL = [
  'position:absolute',
  'pointer-events:auto',
  'min-width:15rem',
  'max-height:calc(100% - 2rem)',
  'overflow:auto',
].join(';');

/**
 * Live action HUD for `?lab=input` (M0.3 AC). Click a binding chip to remap;
 * the next key / mouse button / gamepad control is stolen onto that slot.
 */
export interface InputLab {
  dispose(): void;
}

export function createInputLab(
  input: InputService,
  settings: SettingsStore,
  root: HTMLElement,
): InputLab {
  const overlay = document.createElement('div');
  overlay.dataset.testid = 'input-lab';
  overlay.style.cssText = CSS;

  const actionsPanel = document.createElement('div');
  actionsPanel.style.cssText = PANEL + ';left:1rem;top:1rem';
  const axesPanel = document.createElement('div');
  axesPanel.style.cssText = PANEL + ';left:1rem;bottom:1rem;max-height:42%';
  const bindPanel = document.createElement('div');
  bindPanel.style.cssText = PANEL + ';right:1rem;top:1rem;max-width:26rem';

  overlay.append(actionsPanel, axesPanel, bindPanel);
  root.appendChild(overlay);

  const actionRows = new Map<ActionId, HTMLElement>();
  const axisRows = new Map<AxisId, HTMLElement>();

  const title = (text: string): HTMLElement => {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.cssText = 'letter-spacing:0.2em;margin:0 0 0.6rem;color:#ffb000';
    return h;
  };

  actionsPanel.appendChild(title('ACTIONS'));
  for (const id of ACTIONS) {
    const row = document.createElement('div');
    row.dataset.action = id;
    row.style.cssText = 'display:flex;justify-content:space-between;gap:1rem;padding:1px 0';
    row.innerHTML = `<span>${id}</span><span data-state>—</span>`;
    actionsPanel.appendChild(row);
    actionRows.set(id, row);
  }

  axesPanel.appendChild(title('AXES'));
  for (const id of AXES) {
    const row = document.createElement('div');
    row.dataset.axis = id;
    row.style.cssText = 'display:flex;justify-content:space-between;gap:1rem;padding:1px 0';
    row.innerHTML = `<span>${id}</span><span data-value>0.00</span>`;
    axesPanel.appendChild(row);
    axisRows.set(id, row);
  }
  const mouseRow = document.createElement('div');
  mouseRow.dataset.axis = 'mouse';
  mouseRow.style.cssText = 'display:flex;justify-content:space-between;gap:1rem;padding:1px 0';
  mouseRow.innerHTML = `<span>mouse Δ</span><span data-value>0, 0</span>`;
  axesPanel.appendChild(mouseRow);

  const flags = document.createElement('div');
  flags.dataset.flags = 'status';
  flags.style.cssText = 'margin-top:0.8rem;color:#7aa0c4';
  axesPanel.appendChild(flags);

  bindPanel.appendChild(title('BINDINGS  (click to remap)'));
  const bindList = document.createElement('div');
  bindPanel.appendChild(bindList);

  const textBtn = document.createElement('button');
  textBtn.type = 'button';
  textBtn.textContent = 'start text capture';
  textBtn.dataset.testid = 'text-capture';
  textBtn.style.cssText = btnStyle();
  const textOut = document.createElement('div');
  textOut.dataset.testid = 'text-value';
  textOut.style.cssText = 'margin:0.4rem 0;min-height:1.2em;color:#ffb000';
  bindPanel.append(textBtn, textOut);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'reset bindings';
  resetBtn.dataset.testid = 'reset-bindings';
  resetBtn.style.cssText = btnStyle();
  bindPanel.appendChild(resetBtn);

  const sens = settings.value.input;
  const sliders = document.createElement('div');
  sliders.style.cssText = 'margin-top:0.8rem;display:grid;gap:0.3rem';
  sliders.append(
    slider('mouse sensitivity', 0.1, 5, 0.1, sens.mouseSensitivity, (v) =>
      settings.update({ input: { mouseSensitivity: v } }),
    ),
    slider('gamepad dead zone', 0, 0.5, 0.01, sens.gamepadDeadzone, (v) =>
      settings.update({ input: { gamepadDeadzone: v } }),
    ),
  );
  const invert = document.createElement('label');
  invert.style.cssText = 'display:flex;gap:0.4rem;align-items:center;margin-top:0.3rem';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = sens.invertY;
  box.addEventListener('change', () => settings.update({ input: { invertY: box.checked } }));
  invert.append(box, document.createTextNode('invert Y'));
  sliders.appendChild(invert);
  bindPanel.appendChild(sliders);

  const renderBindings = (): void => {
    bindList.replaceChildren();
    const add = (id: ActionId | AxisId): void => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center;margin:0.2rem 0';
      const name = document.createElement('span');
      name.textContent = id;
      name.style.cssText = 'min-width:6.5rem;color:#7aa0c4';
      row.appendChild(name);
      const list = input.bindings.actions[id as ActionId] ?? input.bindings.axes[id as AxisId];
      list.forEach((source, slot) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.bind = `${id}:${slot}`;
        chip.textContent = formatSource(source);
        chip.style.cssText = chipStyle(input.rebindTarget === id);
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          input.listenRebind(id, slot);
          renderBindings();
        });
        row.appendChild(chip);
      });
      bindList.appendChild(row);
    };
    for (const id of ACTIONS) add(id);
    for (const id of AXES) add(id);
  };
  renderBindings();

  textBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (input.capturingText) {
      input.endTextCapture();
      textBtn.textContent = 'start text capture';
    } else {
      input.beginTextCapture({ value: '' });
      textBtn.textContent = 'stop text capture';
    }
  });
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    input.resetBindings();
    renderBindings();
  });

  let lastRebind = input.rebindTarget;
  let lastCapture = input.capturingText;
  let raf = 0;
  const draw = (): void => {
    const f = input.frame;
    for (const id of ACTIONS) {
      const row = actionRows.get(id)!;
      row.dataset.down = f.down(id) ? '1' : '0';
      const state = row.querySelector('[data-state]')!;
      const bits = [
        f.down(id) ? 'DOWN' : '',
        f.pressed(id) ? 'PRESS' : '',
        f.released(id) ? 'REL' : '',
        f.held(id) > 0 ? f.held(id).toFixed(2) + 's' : '',
      ].filter(Boolean);
      state.textContent = bits.join(' ') || '—';
      row.style.color = f.down(id) ? '#ffb000' : '#a8d8ff';
    }
    const axisValue = (id: AxisId): number => {
      switch (id) {
        case 'lookX':
          return f.lookX;
        case 'lookY':
          return f.lookY;
        case 'thrust':
          return f.thrust;
        case 'strafe':
          return f.strafe;
        case 'vertical':
          return f.vertical;
        case 'knobX':
          return f.knobX;
        case 'knobY':
          return f.knobY;
      }
    };
    for (const id of AXES) {
      const row = axisRows.get(id)!;
      const v = axisValue(id);
      row.dataset.value = String(v);
      row.querySelector('[data-value]')!.textContent = v.toFixed(2);
      row.style.color = Math.abs(v) > 0.02 ? '#ffb000' : '#a8d8ff';
    }
    mouseRow.dataset.value = `${f.mouseDx.toFixed(1)},${f.mouseDy.toFixed(1)}`;
    mouseRow.querySelector('[data-value]')!.textContent =
      `${f.mouseDx.toFixed(1)}, ${f.mouseDy.toFixed(1)}`;

    flags.textContent = [
      f.pointerLocked ? 'POINTER LOCK' : 'click canvas to lock',
      f.gamepadConnected ? 'GAMEPAD' : 'no gamepad',
      f.capturingText ? 'TEXT CAPTURE' : '',
      input.rebindTarget ? `rebind ${input.rebindTarget}…` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    flags.dataset.pointerlock = f.pointerLocked ? '1' : '0';
    flags.dataset.gamepad = f.gamepadConnected ? '1' : '0';
    flags.dataset.capture = f.capturingText ? '1' : '0';

    if (f.capturingText) {
      textOut.textContent = `> ${f.textValue}${f.textEnter ? ' [enter]' : ''}${f.textEscape ? ' [esc]' : ''}`;
    } else if (lastCapture) {
      textOut.textContent = `captured: ${textOut.textContent?.replace(/^> /, '') ?? ''}`;
      textBtn.textContent = 'start text capture';
    }
    if (lastRebind && !input.rebindTarget) renderBindings();
    lastRebind = input.rebindTarget;
    lastCapture = f.capturingText;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      overlay.remove();
    },
  };
}

function btnStyle(): string {
  return [
    'pointer-events:auto',
    'background:#111',
    'color:#a8d8ff',
    'border:1px solid #3a5a7a',
    'padding:0.25rem 0.5rem',
    'margin:0.4rem 0.4rem 0 0',
    'font:inherit',
    'cursor:pointer',
  ].join(';');
}

function chipStyle(waiting: boolean): string {
  return [
    'pointer-events:auto',
    `background:${waiting ? '#3a2a00' : '#111'}`,
    'color:#ffb000',
    'border:1px solid #5a4a20',
    'padding:0 0.35rem',
    'font:inherit',
    'cursor:pointer',
  ].join(';');
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText =
    'display:grid;grid-template-columns:9rem 1fr 3rem;gap:0.4rem;align-items:center';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = document.createElement('span');
  out.textContent = value.toFixed(2);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onChange(v);
  });
  wrap.append(name, input, out);
  return wrap;
}
