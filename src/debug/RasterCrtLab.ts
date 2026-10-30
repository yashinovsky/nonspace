import type { Renderer } from '../render/Renderer';
import { isRasterCrtPass, type RasterCrtPass } from '../render/post/RasterCrtPass';
import { createSmpteTexture } from './smpteCard';

export interface RasterCrtLab {
  update(dt: number): void;
  dispose(): void;
  readonly pass: RasterCrtPass;
}

/**
 * `?lab=raster` — SMPTE 75% bars at 320×240 through RasterCrtPass.
 * Proves M1.7 AC: chroma bleed, 240 scanlines, aperture grille, curvature,
 * and a 0.3 s H-hold / static / tracking transition.
 */
export function installRasterCrtLab(renderer: Renderer): RasterCrtLab {
  renderer.postMode = 'simstim';
  const pass = renderer.chain.rasterCrt;
  if (!isRasterCrtPass(pass)) {
    throw new Error('PostChain.rasterCrt is not a RasterCrtPass');
  }

  const card = createSmpteTexture();
  pass.source = card;

  const hint = document.createElement('div');
  hint.dataset.testid = 'raster-crt-lab';
  hint.style.cssText = [
    'position:absolute',
    'left:12px',
    'top:12px',
    'z-index:2',
    'font:12px/1.4 ui-monospace,monospace',
    'color:#c8d0d8',
    'background:rgba(0,0,0,0.55)',
    'padding:8px 10px',
    'pointer-events:auto',
  ].join(';');
  hint.innerHTML =
    '<div>M1.7 Raster CRT / NTSC</div>' +
    '<div style="opacity:.75">SMPTE 75% · 320×240 · scanlines · grille</div>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Play 0.3s flip';
  btn.style.cssText =
    'margin-top:6px;font:12px ui-monospace,monospace;cursor:pointer;padding:4px 8px';
  btn.addEventListener('click', () => pass.playTransition());
  hint.appendChild(btn);
  renderer.canvas.parentElement?.appendChild(hint);

  return {
    pass,
    update() {},
    dispose() {
      pass.source = null;
      pass.stopTransition();
      card.dispose();
      hint.remove();
    },
  };
}
