import { describe, expect, it } from 'vitest';
import { createGpuTimer } from '../../src/debug/gpuTimer';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

function fakeGl(opts: { ext: boolean }) {
  let nextId = 0;
  const results = new Map<number, { available: boolean; ns: number }>();
  let disjoint = false;
  let active: number | null = null;

  const gl = {
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    getExtension: (name: string) =>
      opts.ext && name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null,
    createQuery: () => ({ id: nextId++ }),
    deleteQuery: () => {},
    beginQuery: (_target: number, q: { id: number }) => {
      if (active !== null) throw new Error('nested query');
      active = q.id;
    },
    endQuery: () => {
      results.set(active!, { available: false, ns: 0 });
      active = null;
    },
    getQueryParameter: (q: { id: number }, pname: number) => {
      const r = results.get(q.id)!;
      return pname === QUERY_RESULT_AVAILABLE ? r.available : r.ns;
    },
    getParameter: (pname: number) => (pname === GPU_DISJOINT_EXT ? disjoint : null),
  };

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    finish(id: number, ms: number) {
      results.set(id, { available: true, ns: ms * 1e6 });
    },
    setDisjoint(v: boolean) {
      disjoint = v;
    },
  };
}

describe('gpuTimer', () => {
  it('returns null without the timer extension', () => {
    expect(createGpuTimer(fakeGl({ ext: false }).gl)).toBeNull();
  });

  it('reports the latest completed query in ms', () => {
    const fake = fakeGl({ ext: true });
    const timer = createGpuTimer(fake.gl, 2)!;

    timer.begin();
    timer.end();
    expect(timer.poll()).toBeNull();

    fake.finish(0, 3.5);
    expect(timer.poll()).toBeCloseTo(3.5);

    timer.begin();
    timer.end();
    fake.setDisjoint(true);
    fake.finish(1, 99);
    expect(timer.poll()).toBeCloseTo(3.5);
  });

  it('skips frames when every query is in flight', () => {
    const fake = fakeGl({ ext: true });
    const timer = createGpuTimer(fake.gl, 1)!;
    timer.begin();
    timer.end();
    expect(() => {
      timer.begin();
      timer.end();
    }).not.toThrow();
  });
});
