#!/usr/bin/env node
/**
 * Compile ink/*.ink → src/content/ink/*.json (plan M6.4).
 *
 * JSON is a compiled `InkStory` (`title`, `initial`, `variables`, `knots`)
 * so the lab chunk does not ship `compileInk` or the raw source.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

const loader = join(root, 'scripts/compile-ink.mts');
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', loader, ...files],
  { cwd: root, encoding: 'utf8' },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'compile-ink failed\n');
  process.exit(result.status ?? 1);
}

const stories = JSON.parse(result.stdout);
for (const file of files) {
  const name = file.replace(/\.ink$/, '');
  const story = stories[name];
  if (!story) {
    console.error(`missing compiled story for ${file}`);
    process.exit(1);
  }
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(story, null, 2)}\n`);
  console.log(`  ${file} → src/content/ink/${name}.json`);
}
