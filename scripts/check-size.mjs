// Fails the build if dist/ exceeds the M0.1 budget (plan §10, M0.1 AC: dist/ under 1 MB).
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LIMIT_BYTES = Number(process.env.DIST_LIMIT_BYTES ?? 1024 * 1024);
const dist = new URL('../dist/', import.meta.url).pathname;

/** @param {string} dir @returns {{ path: string, size: number }[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const st = statSync(path);
    return st.isDirectory() ? walk(path) : [{ path, size: st.size }];
  });
}

const files = walk(dist).sort((a, b) => b.size - a.size);
const total = files.reduce((n, f) => n + f.size, 0);
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;

for (const f of files.slice(0, 8))
  console.log(`  ${kb(f.size).padStart(10)}  ${relative(dist, f.path)}`);
console.log(`dist/ total: ${kb(total)} (limit ${kb(LIMIT_BYTES)})`);

if (total > LIMIT_BYTES) {
  console.error('dist/ exceeds the size budget');
  process.exit(1);
}
