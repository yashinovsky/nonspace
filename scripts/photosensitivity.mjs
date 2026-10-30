#!/usr/bin/env node
/**
 * M8.1 photosensitivity audit (plan §5.9 / §8.10).
 * Frame-steps CPU luma twins of every sequence via Vitest.
 * Implementation: src/a11y/photosensitivity.ts
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/unit/photosensitivity.test.ts', 'tests/unit/a11y.test.ts'],
  { cwd: root, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
