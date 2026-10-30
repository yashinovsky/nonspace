/**
 * GPU frame timer over EXT_disjoint_timer_query_webgl2. Results arrive a few
 * frames late, so queries are pooled in a ring. Only one TIME_ELAPSED query may
 * be active at a time, so begin/end must not nest.
 */
export interface GpuTimer {
  begin(): void;
  end(): void;
  /** Collects finished queries; returns the most recent GPU time in ms, or null if none yet. */
  poll(): number | null;
  readonly lastMs: number | null;
  dispose(): void;
}

export function createGpuTimer(gl: WebGL2RenderingContext, poolSize = 4): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;

  const queries: WebGLQuery[] = [];
  for (let i = 0; i < poolSize; i++) {
    const q = gl.createQuery();
    if (!q) return null;
    queries.push(q);
  }

  let head = 0;
  let pending = 0;
  let active = false;
  let lastMs: number | null = null;

  return {
    begin() {
      if (active || pending >= poolSize) return;
      const q = queries[(head + pending) % poolSize]!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = true;
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      active = false;
      pending++;
    },
    poll() {
      while (pending > 0) {
        const q = queries[head]!;
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) lastMs = ns / 1e6;
        head = (head + 1) % poolSize;
        pending--;
      }
      return lastMs;
    },
    get lastMs() {
      return lastMs;
    },
    dispose() {
      if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (const q of queries) gl.deleteQuery(q);
      queries.length = 0;
      pending = 0;
      active = false;
    },
  };
}
