import { resolveReportEndpoint } from './reportEndpoint';
import { APP_VERSION, GIT_SHA } from './version';

export type ReportLevel = 'error' | 'warn' | 'unhandled';

export interface ReportLine {
  level: ReportLevel;
  text: string;
  stack?: string;
}

export interface ReportPayload {
  v: string;
  sha: string;
  href: string;
  t: number;
  messages: ReportLine[];
}

export interface Reporter {
  readonly endpoint: string | null;
  readonly enabled: boolean;
  readonly queued: readonly ReportLine[];
  capture(level: ReportLevel, text: string, stack?: string): void;
  flush(): void;
  dispose(): void;
}

const MAX_BUFFER = 32;
const MAX_TEXT = 1024;

export interface ReporterHost {
  console: Pick<Console, 'error' | 'warn'>;
  addEventListener(type: string, listener: EventListener, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, opts?: EventListenerOptions): void;
}

export interface ReporterOptions {
  search?: string;
  envEndpoint?: string;
  endpoint?: string | null;
  fetch?: typeof fetch;
  sendBeacon?: (url: string, data: BodyInit) => boolean;
  host?: ReporterHost;
  now?: () => number;
  version?: string;
  sha?: string;
  href?: string;
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function lineText(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a) ?? String(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function stackOf(args: unknown[]): string | undefined {
  for (const a of args) {
    if (a instanceof Error && a.stack) return clip(a.stack);
  }
  return undefined;
}

/**
 * Console / crash capture to an optional endpoint. No-op when the endpoint
 * is unset (default). Never throws; send failures are swallowed.
 */
export function installReporter(opts: ReporterOptions = {}): Reporter {
  const endpoint =
    opts.endpoint !== undefined
      ? opts.endpoint
      : resolveReportEndpoint(opts.search ?? '', opts.envEndpoint);
  const queued: ReportLine[] = [];
  if (!endpoint) {
    return {
      endpoint: null,
      enabled: false,
      queued,
      capture() {},
      flush() {},
      dispose() {},
    };
  }

  const host = opts.host;
  const now = opts.now ?? (() => Date.now());
  const version = opts.version ?? APP_VERSION;
  const sha = opts.sha ?? GIT_SHA;
  const href = opts.href ?? (typeof location !== 'undefined' ? location.href : '');
  const originalError = host?.console.error.bind(host.console);
  const originalWarn = host?.console.warn.bind(host.console);
  let sending = false;
  let disposed = false;

  const capture = (level: ReportLevel, text: string, stack?: string): void => {
    if (disposed || queued.length >= MAX_BUFFER) return;
    const line: ReportLine = { level, text: clip(text) };
    if (stack) line.stack = clip(stack);
    queued.push(line);
  };

  const payload = (): ReportPayload => ({
    v: version,
    sha,
    href,
    t: now(),
    messages: queued.slice(),
  });

  const flush = (): void => {
    if (disposed || sending || queued.length === 0) return;
    sending = true;
    const body = JSON.stringify(payload());
    queued.length = 0;
    try {
      const beacon = opts.sendBeacon;
      if (beacon) {
        const ok = beacon(endpoint, body);
        if (ok) {
          sending = false;
          return;
        }
      }
      const post = opts.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
      if (!post) {
        sending = false;
        return;
      }
      void post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* swallow */
    } finally {
      sending = false;
    }
  };

  const onError: EventListener = (event) => {
    const e = event as ErrorEvent;
    const text = e.message || String(e.error ?? 'error');
    const stack = e.error instanceof Error ? e.error.stack : undefined;
    capture('unhandled', text, stack);
  };
  const onReject: EventListener = (event) => {
    const e = event as PromiseRejectionEvent;
    const reason = e.reason;
    const text = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    capture('unhandled', text, stack);
  };
  const onHide: EventListener = () => {
    flush();
  };

  if (host) {
    host.console.error = (...args: unknown[]) => {
      capture('error', lineText(args), stackOf(args));
      originalError?.(...args);
    };
    host.console.warn = (...args: unknown[]) => {
      capture('warn', lineText(args), stackOf(args));
      originalWarn?.(...args);
    };
    host.addEventListener('error', onError);
    host.addEventListener('unhandledrejection', onReject);
    host.addEventListener('pagehide', onHide);
    host.addEventListener('visibilitychange', onHide);
  }

  return {
    endpoint,
    enabled: true,
    queued,
    capture,
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!host) return;
      if (originalError) host.console.error = originalError;
      if (originalWarn) host.console.warn = originalWarn;
      host.removeEventListener('error', onError);
      host.removeEventListener('unhandledrejection', onReject);
      host.removeEventListener('pagehide', onHide);
      host.removeEventListener('visibilitychange', onHide);
    },
  };
}
