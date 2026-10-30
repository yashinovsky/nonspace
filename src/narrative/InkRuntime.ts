/**
 * Minimal Ink (inkle) subset for meatspace interludes (plan §4.2, M6.4).
 *
 * Supported: `=== knot ===`, text, `* [label] -> knot`, `-> knot` / `-> END`,
 * `VAR name = value`, `~ name = expr`, `{name}` interpolation,
 * `{name:then|else}` and `{name op value:then|else}`, `# tags`.
 *
 * Full inkjs + inklecate stay available for campaign Ink in M7.0+; this
 * runtime is small enough for the dist budget and needs no native compiler.
 */

export interface InkChoice {
  /** 1–4, matching `soft1`–`soft4` / Digit1–4. */
  index: number;
  text: string;
  divert: string;
}

export interface InkKnot {
  name: string;
  lines: string[];
  tags: string[];
  choices: InkChoice[];
  divert: string | null;
}

export interface InkStory {
  title: string;
  initial: string;
  variables: Record<string, string | number | boolean>;
  knots: Record<string, InkKnot>;
}

export interface InkModule {
  /** Raw .ink source, as produced by `scripts/build-ink.mjs`. */
  source?: string;
  title?: string;
  initial?: string;
  variables?: Record<string, string | number | boolean>;
  knots?: Record<string, InkKnot>;
}

export interface InkState {
  knot: string;
  text: string[];
  tags: string[];
  choices: InkChoice[];
  ended: boolean;
}

const END = 'END';

function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i >= 0 ? line.slice(0, i) : line;
}

function parseValue(raw: string): string | number | boolean {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '""' || s === "''") return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : s;
}

function truthy(v: string | number | boolean | undefined): boolean {
  if (v === undefined || v === false || v === 0 || v === '') return false;
  return true;
}

function interpolate(text: string, vars: Record<string, string | number | boolean>): string {
  return text.replace(/\{([^}]+)\}/g, (_, inner: string) => {
    const body = inner.trim();
    const colon = body.indexOf(':');
    if (colon >= 0) {
      const expr = body.slice(0, colon).trim();
      const rest = body.slice(colon + 1);
      const bar = rest.indexOf('|');
      const yes = bar >= 0 ? rest.slice(0, bar) : rest;
      const no = bar >= 0 ? rest.slice(bar + 1) : '';
      return evalCond(expr, vars) ? yes : no;
    }
    const v = vars[body];
    return v === undefined ? '' : String(v);
  });
}

function evalCond(expr: string, vars: Record<string, string | number | boolean>): boolean {
  const cmp = expr.match(/^([A-Za-z_][\w]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (cmp) {
    const left = vars[cmp[1]!] ?? 0;
    const right = parseValue(cmp[3]!);
    const op = cmp[2]!;
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    const a = Number(left);
    const b = Number(right);
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
  }
  return truthy(vars[expr.trim()]);
}

function parseChoice(line: string): InkChoice | null {
  const m = line.match(/^[ *\t]*\*\s*(?:\[([^\]]*)\])?\s*(.*?)\s*(?:->\s*(\S+))?\s*$/);
  if (!m) return null;
  const label = (m[1] ?? m[2] ?? '').trim();
  const rest = (m[1] ? m[2] : '').trim();
  const text = label || rest;
  const divert = (m[3] ?? END).replace(/^\s+|\s+$/g, '');
  return { index: 0, text, divert };
}

function parseDivert(line: string): string | null {
  const m = line.match(/^->\s*(\S+)\s*$/);
  return m ? m[1]! : null;
}

/**
 * Compile a subset of Ink source into an `InkStory`. Throws on empty input
 * or a missing initial knot.
 */
export function compileInk(source: string, title = 'story'): InkStory {
  const knots: Record<string, InkKnot> = {};
  const variables: Record<string, string | number | boolean> = {};
  let current: InkKnot | null = null;
  let initial = '';
  let choiceIndex = 0;

  const ensure = (name: string): InkKnot => {
    const existing = knots[name];
    if (existing) return existing;
    const k: InkKnot = { name, lines: [], tags: [], choices: [], divert: null };
    knots[name] = k;
    return k;
  };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    const knot = line.match(/^===\s*([A-Za-z_][\w.]*)\s*===\s*$/);
    if (knot) {
      current = ensure(knot[1]!);
      if (!initial) initial = current.name;
      choiceIndex = 0;
      continue;
    }

    const varDecl = line.match(/^VAR\s+([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (varDecl) {
      variables[varDecl[1]!] = parseValue(varDecl[2]!);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('#')) {
      current.tags.push(line.slice(1).trim());
      continue;
    }

    const assign = line.match(/^~\s*([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (assign) {
      current.lines.push(`~${assign[1]}=${assign[2]}`);
      continue;
    }

    if (line.startsWith('*') || line.startsWith('+')) {
      const ch = parseChoice(line);
      if (ch) {
        choiceIndex += 1;
        if (choiceIndex <= 4) {
          ch.index = choiceIndex;
          current.choices.push(ch);
        }
      }
      continue;
    }

    const div = parseDivert(line);
    if (div) {
      current.divert = div;
      continue;
    }

    current.lines.push(line);
  }

  if (!initial) throw new Error('Ink story has no knots');
  return { title, initial, variables, knots };
}

export function loadInkModule(mod: InkModule, title?: string): InkStory {
  if (mod.source) return compileInk(mod.source, title ?? mod.title ?? 'story');
  if (mod.knots && mod.initial) {
    return {
      title: mod.title ?? title ?? 'story',
      initial: mod.initial,
      variables: { ...(mod.variables ?? {}) },
      knots: mod.knots,
    };
  }
  throw new Error('Ink module has neither source nor knots');
}

export interface InkRuntime {
  readonly story: InkStory;
  readonly state: InkState;
  goto(knot: string): InkState;
  /** Pick choice 1–4. Returns false if that slot is empty. */
  choose(n: number): boolean;
  get(name: string): string | number | boolean | undefined;
  set(name: string, value: string | number | boolean): void;
  tag(prefix: string): string | undefined;
  hasTag(tag: string): boolean;
}

function applyAssigns(
  lines: readonly string[],
  vars: Record<string, string | number | boolean>,
): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('~')) {
      const eq = line.indexOf('=');
      const name = line.slice(1, eq);
      const value = parseValue(line.slice(eq + 1));
      vars[name] = value;
      continue;
    }
    out.push(interpolate(line, vars));
  }
  return out;
}

export function createInkRuntime(story: InkStory): InkRuntime {
  const vars: Record<string, string | number | boolean> = { ...story.variables };
  const state: InkState = {
    knot: '',
    text: [],
    tags: [],
    choices: [],
    ended: false,
  };

  const runtime: InkRuntime = {
    story,
    state,
    goto(name) {
      let target = name;
      const seen = new Set<string>();
      for (;;) {
        if (target === END) {
          state.knot = END;
          state.text = [];
          state.tags = [];
          state.choices = [];
          state.ended = true;
          return state;
        }
        if (seen.has(target)) throw new Error(`Ink divert cycle at '${target}'`);
        seen.add(target);
        const knot = story.knots[target];
        if (!knot) throw new Error(`Ink knot '${target}' not found`);
        const text = applyAssigns(knot.lines, vars);
        if (text.length === 0 && knot.choices.length === 0 && knot.divert) {
          target = knot.divert;
          continue;
        }
        state.knot = knot.name;
        state.text = text;
        state.tags = knot.tags.slice();
        state.choices = knot.choices.map((c) => ({
          ...c,
          text: interpolate(c.text, vars),
        }));
        state.ended = false;
        return state;
      }
    },
    choose(n) {
      if (n < 1 || n > 4) return false;
      const ch = state.choices.find((c) => c.index === n);
      if (!ch) return false;
      runtime.goto(ch.divert);
      return true;
    },
    get(name) {
      return vars[name];
    },
    set(name, value) {
      vars[name] = value;
    },
    tag(prefix) {
      const hit = state.tags.find((t) => t === prefix || t.startsWith(`${prefix}:`));
      if (!hit) return undefined;
      const colon = hit.indexOf(':');
      return colon >= 0 ? hit.slice(colon + 1).trim() : hit;
    },
    hasTag(tag) {
      return state.tags.some((t) => t === tag || t.startsWith(`${tag}:`));
    },
  };
  runtime.goto(story.initial);
  return runtime;
}
