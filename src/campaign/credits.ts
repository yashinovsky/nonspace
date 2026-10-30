/**
 * Ending A credits (plan M7.11). Font attributions required by §6.5 / M3.1.
 * Ending B keeps the Beach raytraced overlay — do not reuse this on M6.
 */

const CSS =
  'display:none;position:absolute;inset:12% 8% auto 8%;text-align:center;' +
  'font-family:ui-monospace,Menlo,Consolas,monospace;color:#4dff5a;' +
  'letter-spacing:0.18em;line-height:1.85;text-transform:uppercase;' +
  'text-shadow:0 0 8px rgba(77,255,90,0.35);pointer-events:none;';

const BODY = [
  '<div data-testid="credits-title" style="font-size:1.6rem;letter-spacing:0.48em">NONSPACE</div>',
  '<div data-testid="credits-ending" style="font-size:0.72rem;margin-top:0.6rem">Ending A — the merge completes</div>',
  '<div style="font-size:0.62rem;margin-top:1.6rem;letter-spacing:0.28em">Fonts</div>',
  '<div data-testid="credits-fonts" style="font-size:0.58rem;margin-top:0.5rem;letter-spacing:0.08em;text-transform:none;line-height:1.7">',
  'Hershey vector fonts — Dr. A. V. Hershey / James Hurt<br/>',
  'Px437 IBM CGA / IBM BIOS — VileR, CC BY-SA 4.0<br/>',
  'VFD 7- and 14-segment glyphs — in-house',
  '</div>',
].join('');

export interface EndingCredits {
  readonly visible: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

export function createEndingCredits(parent: HTMLElement): EndingCredits {
  const el = document.createElement('div');
  el.dataset.testid = 'ending-credits';
  el.style.cssText = CSS;
  el.innerHTML = BODY;
  parent.appendChild(el);
  let visible = false;

  return {
    get visible() {
      return visible;
    },
    show() {
      visible = true;
      el.style.display = 'block';
      parent.dataset.ending = 'A';
    },
    hide() {
      visible = false;
      el.style.display = 'none';
    },
    dispose() {
      visible = false;
      el.remove();
    },
  };
}
