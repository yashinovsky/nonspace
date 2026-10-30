/** True when `value` is an http(s) URL we may POST crash reports to. */
export function isReportEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Crash reporter is **off by default**. Enable with `?report=<https-url>` or
 * `VITE_REPORT_ENDPOINT` at build time. `?report=0` forces off.
 */
export function resolveReportEndpoint(
  search: string,
  envEndpoint: string | undefined = import.meta.env.VITE_REPORT_ENDPOINT,
): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const q = new URLSearchParams(raw).get('report');
  if (q === '0' || q === 'off' || q === 'false') return null;
  if (q && isReportEndpoint(q)) return q;
  if (typeof envEndpoint === 'string' && isReportEndpoint(envEndpoint)) return envEndpoint;
  return null;
}
