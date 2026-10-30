import { describe, expect, it } from 'vitest';
import { compileInk, createInkRuntime, type InkStory } from '../../src/narrative/InkRuntime';
import testInk from '../../src/content/ink/teletext-test.json';

describe('Ink subset compiler', () => {
  it('compiles knots, 1–4 choices, tags, vars and interpolation', () => {
    const story = compileInk(`
VAR heat = 0
=== start ===
# page:test
Hello {heat}
* [ONE] -> a
* [TWO] -> b
* [THREE] -> c
* [FOUR] -> d
=== a ===
# page:text
~ heat = 2
A {heat > 0:hot|cold}
-> END
=== b ===
B
-> END
=== c ===
C
-> END
=== d ===
D
-> END
`);
    expect(story.initial).toBe('start');
    expect(story.knots.start?.choices).toHaveLength(4);
    expect(story.knots.start?.choices[0]).toMatchObject({
      index: 1,
      text: 'ONE',
      divert: 'a',
    });
    expect(story.knots.start?.tags).toContain('page:test');

    const rt = createInkRuntime(story);
    expect(rt.state.text[0]).toBe('Hello 0');
    expect(rt.state.choices.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    expect(rt.choose(1)).toBe(true);
    expect(rt.state.knot).toBe('a');
    expect(rt.state.text[0]).toBe('A hot');
    expect(rt.get('heat')).toBe(2);
  });

  it('rejects a fifth choice and a missing knot', () => {
    const story = compileInk(`
=== start ===
* [1] -> start
* [2] -> start
* [3] -> start
* [4] -> start
* [5] -> nowhere
`);
    expect(story.knots.start?.choices).toHaveLength(4);
    const rt = createInkRuntime(story);
    expect(rt.choose(5)).toBe(false);
    expect(rt.choose(2)).toBe(true);
  });

  it('follows empty divert-only knots and ends at END', () => {
    const story = compileInk(`
=== start ===
Hi
-> glue
=== glue ===
-> done
=== done ===
Bye
* [OK] -> END
`);
    const rt = createInkRuntime(story);
    expect(rt.state.knot).toBe('start');
    expect(rt.state.text).toEqual(['Hi']);
    // start has a divert and no choices — stay on the page with text.
    expect(rt.state.choices).toEqual([]);
    rt.goto('glue');
    expect(rt.state.knot).toBe('done');
    expect(rt.choose(1)).toBe(true);
    expect(rt.state.ended).toBe(true);
    expect(rt.state.knot).toBe('END');
  });
});

describe('teletext-test.ink', () => {
  it('loads from the committed JSON module and offers 4 opening choices', () => {
    const story = testInk as InkStory;
    const rt = createInkRuntime(story);
    expect(Object.keys(story.knots)).toEqual(
      expect.arrayContaining(['start', 'street', 'phone', 'clinic', 'jack', 'pickup']),
    );
    expect(rt.state.choices).toHaveLength(4);
    expect(rt.tag('page')).toBe('test');
    expect(rt.choose(2)).toBe(true);
    expect(rt.state.knot).toBe('phone');
    expect(rt.hasTag('ring')).toBe(true);
    expect(rt.tag('page')).toBe('phone');
  });
});
