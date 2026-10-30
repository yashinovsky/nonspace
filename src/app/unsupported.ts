export type FeatureId = 'webgl2' | 'workers' | 'esmodules';

export interface SupportReport {
  ok: boolean;
  missing: FeatureId[];
}

export const FEATURE_LABELS: Record<FeatureId, string> = {
  webgl2: 'WebGL2',
  workers: 'Web Workers',
  esmodules: 'JavaScript modules',
};

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

export function hasWorkers(host: { Worker?: unknown } = globalThis): boolean {
  return typeof host.Worker === 'function';
}

export function probeSupport(opts?: {
  hasWebGL2?: () => boolean;
  hasWorker?: boolean;
}): SupportReport {
  const missing: FeatureId[] = [];
  const webgl2 = opts?.hasWebGL2 ?? hasWebGL2;
  if (!webgl2()) missing.push('webgl2');
  const workerOk = opts?.hasWorker ?? hasWorkers();
  if (!workerOk) missing.push('workers');
  return { ok: missing.length === 0, missing };
}

function fillMissingList(list: Element, missing: FeatureId[]): void {
  list.replaceChildren();
  const ids = missing.length > 0 ? missing : (['webgl2'] satisfies FeatureId[]);
  for (const id of ids) {
    const li = document.createElement('li');
    li.textContent = FEATURE_LABELS[id];
    list.appendChild(li);
  }
}

function paintPage(page: HTMLElement, missing: FeatureId[]): void {
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
    'z-index:3',
  ].join(';');

  const labels = missing.map((id) => FEATURE_LABELS[id]);
  const need = labels.length > 0 ? labels.join(', ') : FEATURE_LABELS.webgl2;

  page.innerHTML = `
    <div style="max-width:36rem">
      <h1 style="font-size:1.25rem;letter-spacing:0.3em;margin:0 0 1rem">NONSPACE</h1>
      <p style="margin:0 0 1rem">The deck can't jack in: this browser is missing <strong>${need}</strong>, which the game needs to draw the matrix.</p>
      <ul id="unsupported-missing" style="margin:0 0 1rem;padding-left:1.25rem"></ul>
      <ul style="margin:0 0 1rem;padding-left:1.25rem">
        <li>Use a current Chrome, Edge, Firefox, or Safari 15+.</li>
        <li>Turn on hardware acceleration in your browser settings.</li>
        <li>Update your graphics drivers, then reload this page.</li>
      </ul>
      <p style="margin:0">Check your setup at <a style="color:#ffb000" href="https://get.webgl.org/webgl2/" rel="noopener">get.webgl.org/webgl2</a>.</p>
    </div>`;
  const list = page.querySelector('#unsupported-missing');
  if (list) fillMissingList(list, missing);
}

/**
 * Friendly static page when WebGL2 or another required API is missing.
 * Reuses `#unsupported-page` from index.html when present.
 */
export function showUnsupported(root: HTMLElement, report?: SupportReport): void {
  const missing = report?.missing ?? probeSupport().missing;
  root.replaceChildren();
  root.dataset.status = 'unsupported';

  const existing = document.getElementById('unsupported-page');
  if (existing) {
    existing.hidden = false;
    existing.setAttribute('role', 'alert');
    const list = existing.querySelector('#unsupported-missing');
    if (list) fillMissingList(list, missing);
    const detail = existing.querySelector('[data-unsupported-detail]');
    if (detail) {
      const labels = missing.map((id) => FEATURE_LABELS[id]);
      detail.textContent =
        labels.length > 0
          ? `The deck can't jack in: this browser is missing ${labels.join(', ')}, which the game needs to draw the matrix.`
          : "The deck can't jack in: this browser didn't give us WebGL2, which the game needs to draw the matrix.";
    }
    return;
  }

  const page = document.createElement('main');
  paintPage(page, missing);
  root.appendChild(page);
}
