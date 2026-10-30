/** Build identity injected by Vite (`vite.config.ts` `define`). */
export const APP_VERSION: string = __NONSPACE_VERSION__;
export const GIT_SHA: string = __NONSPACE_SHA__;

export function shortSha(sha = GIT_SHA): string {
  if (!sha || sha === 'unknown') return '';
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/** Discreet boot stamp: package version plus git SHA when known. */
export function formatStamp(version = APP_VERSION, sha = GIT_SHA): string {
  const short = shortSha(sha);
  return short ? `${version} · ${short}` : version;
}

export function mountVersionStamp(el: HTMLElement | null, stamp = formatStamp()): void {
  if (!el) return;
  el.textContent = stamp;
  el.hidden = false;
  el.setAttribute('aria-label', `NONSPACE ${stamp}`);
}
