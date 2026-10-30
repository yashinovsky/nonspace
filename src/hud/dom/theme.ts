/**
 * Shared 1984 deck-CRT chrome for DOM menus (plan §6.3–6.4). Phosphor green
 * on black, GRID-blue vector bezels, amber VFD labels — not Cyberpunk 2077.
 */

export const COLOR_GRID = '#a8d8ff';
export const COLOR_AMBER = '#ffb000';
export const COLOR_P31 = '#4dff5a';
export const COLOR_AFTERGLOW = '#c6f03a';
export const COLOR_BEZEL = '#0a0c10';
export const CRT_FONT =
  'ui-monospace, "PxPlus IBM VGA8", "IBM VGA 8x16", "Lucida Console", Menlo, Consolas, monospace';

const STYLE_ID = 'nonspace-crt-chrome';

const CSS = `
.ns-crt-root{position:fixed;inset:0;z-index:30;pointer-events:none;font-family:${CRT_FONT};color:${COLOR_P31};text-transform:uppercase}
.ns-crt-root *{box-sizing:border-box}
.ns-dim{position:absolute;inset:0;background:rgba(0,0,0,0.55);pointer-events:none}
.ns-dim::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(168,216,255,0.06) 32px),repeating-linear-gradient(90deg,transparent,transparent 31px,rgba(168,216,255,0.06) 32px);opacity:.7}
.ns-faceplate{position:absolute;inset:6% 8%;pointer-events:auto;background:${COLOR_BEZEL};border:1px solid ${COLOR_GRID};box-shadow:inset 0 0 0 6px #050608,0 0 0 1px #1a2430;display:flex;flex-direction:column;min-width:20rem}
.ns-faceplate::before,.ns-faceplate::after{content:"";position:absolute;width:18px;height:18px;border-color:${COLOR_GRID};border-style:solid;pointer-events:none}
.ns-faceplate::before{top:8px;left:8px;border-width:2px 0 0 2px}
.ns-faceplate::after{top:8px;right:8px;border-width:2px 2px 0 0}
.ns-plate-corners{position:absolute;left:8px;right:8px;bottom:8px;height:18px;pointer-events:none}
.ns-plate-corners::before,.ns-plate-corners::after{content:"";position:absolute;width:18px;height:18px;border-color:${COLOR_GRID};border-style:solid}
.ns-plate-corners::before{left:0;bottom:0;border-width:0 0 2px 2px}
.ns-plate-corners::after{right:0;bottom:0;border-width:0 2px 2px 0}
.ns-mast{display:flex;justify-content:space-between;align-items:baseline;padding:1.1rem 1.4rem 0.55rem;letter-spacing:0.32em;color:${COLOR_GRID};font-size:11px}
.ns-logo{font-weight:700;letter-spacing:0.42em;color:transparent;-webkit-text-stroke:1px ${COLOR_GRID};text-stroke:1px ${COLOR_GRID};font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;font-size:clamp(14px,2.1vw,22px)}
.ns-model{color:${COLOR_AMBER};letter-spacing:0.28em;font-size:10px}
.ns-tabs{display:flex;gap:0;padding:0 1.2rem;border-bottom:1px solid #1c2a38}
.ns-tab{pointer-events:auto;background:transparent;color:${COLOR_GRID};border:1px solid transparent;border-bottom:none;padding:0.4rem 0.85rem;font:inherit;letter-spacing:0.22em;font-size:11px;cursor:pointer}
.ns-tab[aria-selected="true"]{color:${COLOR_AMBER};border-color:${COLOR_GRID};background:#05080c}
.ns-crt{flex:1;margin:0.7rem 1.2rem 1.1rem;background:#000;border:1px solid #16301c;box-shadow:inset 0 0 40px rgba(0,40,10,0.45);position:relative;overflow:auto;padding:0.85rem 1rem;color:${COLOR_P31};font-size:13px;line-height:1.45;letter-spacing:0.04em;text-transform:none}
.ns-crt::after{content:"";pointer-events:none;position:absolute;inset:0;background:repeating-linear-gradient(to bottom,rgba(0,0,0,0.18) 0,rgba(0,0,0,0.18) 1px,transparent 1px,transparent 3px);opacity:.45}
.ns-row{display:flex;gap:0.8rem;padding:0.12rem 0;flex-wrap:wrap}
.ns-key{color:${COLOR_AMBER};min-width:7.5rem;letter-spacing:0.18em;font-size:11px}
.ns-muted{color:#6a8a72}
.ns-err{color:#ff3b1f}
.ns-btn{pointer-events:auto;background:#05080c;color:${COLOR_P31};border:1px solid #1a4a28;padding:0.2rem 0.55rem;font:inherit;letter-spacing:0.12em;cursor:pointer;font-size:12px}
.ns-btn:hover,.ns-btn:focus{border-color:${COLOR_AFTERGLOW};color:${COLOR_AFTERGLOW}}
.ns-btn[disabled]{opacity:.4;cursor:not-allowed}
.ns-field{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.18rem 0;border-bottom:1px solid #0c1810}
.ns-field[data-focused="1"]{outline:1px solid ${COLOR_AMBER};background:#0a120c}
.ns-field label{letter-spacing:0.12em;font-size:12px}
.ns-field input,.ns-field select{accent-color:${COLOR_P31};background:#000;color:${COLOR_P31};border:1px solid #1a4a28;font:inherit;padding:0.15rem 0.3rem}
.ns-legend{color:${COLOR_AMBER};letter-spacing:0.28em;font-size:11px;margin:0.7rem 0 0.25rem}
.ns-settings{position:absolute;inset:8% 12%;pointer-events:auto;background:${COLOR_BEZEL};border:1px solid ${COLOR_AMBER};box-shadow:inset 0 0 0 5px #050608;display:flex;flex-direction:column;z-index:40;max-height:84%}
.ns-settings-body{flex:1;overflow:auto;padding:0.6rem 1.1rem 1rem}
.ns-bind{display:inline-block;margin:0 0.2rem 0.2rem 0;padding:0.12rem 0.4rem;border:1px solid #2a4a66;color:${COLOR_GRID};background:#071018;cursor:pointer;font:inherit;letter-spacing:0.08em;font-size:11px;text-transform:none}
.ns-bind[data-listening="1"]{border-color:${COLOR_AMBER};color:${COLOR_AMBER}}
.ns-subtitles{position:fixed;left:10%;right:10%;bottom:8%;z-index:25;pointer-events:none;text-align:center;font-family:${CRT_FONT};letter-spacing:0.06em;line-height:1.35;color:${COLOR_AFTERGLOW}}
.ns-subtitles[data-size="small"]{font-size:14px}
.ns-subtitles[data-size="medium"]{font-size:20px}
.ns-subtitles[data-size="large"]{font-size:28px}
.ns-subtitles span{display:inline-block;padding:0.25em 0.7em}
.ns-boot,.ns-title{position:absolute;inset:0;pointer-events:auto;background:#000;display:flex;flex-direction:column;justify-content:center;padding:8% 12%;z-index:35;color:${COLOR_P31}}
.ns-title .ns-logo{font-size:clamp(18px,4vw,42px);margin:0 0 1.4rem}
.ns-prompt{color:${COLOR_AMBER};letter-spacing:0.35em;font-size:13px;animation:ns-blink 1.2s steps(2) infinite}
@keyframes ns-blink{50%{opacity:0}}
.ns-reduce-flash .ns-prompt{animation:none}
.ns-post{white-space:pre;font-size:13px;line-height:1.5;letter-spacing:0.08em}
`;

/** Inject the deck-CRT stylesheet once. Safe to call from node (no-op). */
export function ensureCrtStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
