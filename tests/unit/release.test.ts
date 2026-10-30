import { describe, expect, it, vi } from 'vitest';
import { isReportEndpoint, resolveReportEndpoint } from '../../src/app/reportEndpoint';
import { installReporter, type ReporterHost } from '../../src/app/reporter';
import { probeSupport, FEATURE_LABELS } from '../../src/app/unsupported';
import { formatStamp, shortSha } from '../../src/app/version';

describe('report endpoint (off by default)', () => {
  it('rejects non-http values', () => {
    expect(isReportEndpoint('')).toBe(false);
    expect(isReportEndpoint('1')).toBe(false);
    expect(isReportEndpoint('javascript:alert(1)')).toBe(false);
    expect(isReportEndpoint('https://example.test/ingest')).toBe(true);
    expect(isReportEndpoint('http://localhost:4173/ingest')).toBe(true);
  });

  it('is null without ?report= or env', () => {
    expect(resolveReportEndpoint('', undefined)).toBeNull();
    expect(resolveReportEndpoint('debug=1', undefined)).toBeNull();
    expect(resolveReportEndpoint('report=1', undefined)).toBeNull();
  });

  it('enables on ?report=https and disables on ?report=0', () => {
    expect(resolveReportEndpoint('?report=https://example.test/ingest', undefined)).toBe(
      'https://example.test/ingest',
    );
    expect(resolveReportEndpoint('?report=0', 'https://example.test/from-env')).toBeNull();
    expect(resolveReportEndpoint('', 'https://example.test/from-env')).toBe(
      'https://example.test/from-env',
    );
  });
});

describe('crash reporter', () => {
  function fakeHost(): ReporterHost & { error: unknown[][]; warn: unknown[][] } {
    const error: unknown[][] = [];
    const warn: unknown[][] = [];
    const listeners = new Map<string, EventListener[]>();
    const host: ReporterHost & { error: unknown[][]; warn: unknown[][] } = {
      error,
      warn,
      console: {
        error: (...args: unknown[]) => {
          error.push(args);
        },
        warn: (...args: unknown[]) => {
          warn.push(args);
        },
      },
      addEventListener(type, listener) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
      removeEventListener(type, listener) {
        const list = listeners.get(type);
        if (!list) return;
        listeners.set(
          type,
          list.filter((l) => l !== listener),
        );
      },
    };
    return host;
  }

  it('does not wrap console when no endpoint', () => {
    const host = fakeHost();
    const err = host.console.error;
    const r = installReporter({ endpoint: null, host });
    expect(r.enabled).toBe(false);
    expect(host.console.error).toBe(err);
    host.console.error('x');
    expect(r.queued).toEqual([]);
  });

  it('captures console.error and POSTs on flush', async () => {
    const host = fakeHost();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const r = installReporter({
      endpoint: 'https://example.test/ingest',
      host,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => 42,
      version: '0.0.0',
      sha: 'deadbee',
      href: 'http://localhost/',
    });
    expect(r.enabled).toBe(true);
    host.console.error('deck fault', new Error('boom'));
    expect(r.queued[0]?.level).toBe('error');
    expect(r.queued[0]?.text).toContain('deck fault');
    r.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { messages: { text: string }[]; sha: string };
    expect(body.sha).toBe('deadbee');
    expect(body.messages[0]?.text).toContain('deck fault');
    expect(r.queued).toEqual([]);
  });
});

describe('support probe', () => {
  it('lists WebGL2 and Workers when missing', () => {
    const none = probeSupport({ hasWebGL2: () => false, hasWorker: false });
    expect(none.ok).toBe(false);
    expect(none.missing).toEqual(['webgl2', 'workers']);
    expect(FEATURE_LABELS.webgl2).toBe('WebGL2');
    const ok = probeSupport({ hasWebGL2: () => true, hasWorker: true });
    expect(ok).toEqual({ ok: true, missing: [] });
  });
});

describe('version stamp', () => {
  it('formats package version plus short SHA', () => {
    expect(shortSha('135205ed63c891de')).toBe('135205e');
    expect(formatStamp('0.0.0', 'abc1234')).toBe('0.0.0 · abc1234');
    expect(formatStamp('0.0.0', 'unknown')).toBe('0.0.0');
  });
});
