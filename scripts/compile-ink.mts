import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileInk } from '../src/narrative/InkRuntime.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stories: Record<string, unknown> = {};
for (const file of process.argv.slice(2)) {
  const name = file.replace(/\.ink$/, '');
  const source = readFileSync(join(root, 'ink', file), 'utf8');
  stories[name] = compileInk(source, name);
}
process.stdout.write(JSON.stringify(stories));
