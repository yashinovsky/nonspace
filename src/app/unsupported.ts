export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function showUnsupported(root: HTMLElement): void {
  root.replaceChildren();
  root.dataset.status = 'unsupported';

  const page = document.createElement('main');
  page.className = 'unsupported';
  page.setAttribute('role', 'alert');
  page.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'justify-content:center',
    'align-items:center',
    'padding:2rem',
    'background:#000',
    'color:#a8d8ff',
    'font:16px/1.5 ui-monospace, Menlo, Consolas, monospace',
    'text-align:left',
  ].join(';');

  page.innerHTML = `
    <div style="max-width:36rem">
      <h1 style="font-size:1.25rem;letter-spacing:0.3em;margin:0 0 1rem">NONSPACE</h1>
      <p style="margin:0 0 1rem">The deck can't jack in: this browser didn't give us <strong>WebGL2</strong>, which the game needs to draw the matrix.</p>
      <ul style="margin:0 0 1rem;padding-left:1.25rem">
        <li>Use a current Chrome, Edge, Firefox, or Safari 15+.</li>
        <li>Turn on hardware acceleration in your browser settings.</li>
        <li>Update your graphics drivers, then reload this page.</li>
      </ul>
      <p style="margin:0">Check your setup at <a style="color:#ffb000" href="https://get.webgl.org/webgl2/" rel="noopener">get.webgl.org/webgl2</a>.</p>
    </div>`;

  root.appendChild(page);
}
