#!/usr/bin/env node
/**
 * Compile ink/*.ink → src/content/ink/*.json (plan M6.4).
 *
 * JSON is `{ "source": "<ink text>" }` so the TypeScript `compileInk`
 * in `src/narrative/InkRuntime.ts` stays the single compiler. Runtime
 * loads the JSON and compiles once on Interlude enter.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'ink');
const outDir = join(root, 'src/content/ink');

mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith('.ink'));
if (files.length === 0) {
  console.error('no .ink files in ink/');
  process.exit(1);
}

for (const file of files) {
  const source = readFileSync(join(srcDir, file), 'utf8');
  const name = file.replace(/\.ink$/, '');
  const json = `${JSON.stringify({ title: name, source }, null, 2)}\n`;
  const out = join(outDir, `${name}.json`);
  writeFileSync(out, json);
  console.log(`  ${file} → src/content/ink/${name}.json`);
}
