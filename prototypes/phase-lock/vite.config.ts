import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under any static path (e.g. GitHub Pages project subpath).
  base: './',
  // The lab imports the game's src/breach/PhaseLock.ts from the repo root.
  server: { host: true, port: 5174, fs: { allow: ['../..'] } },
  build: { outDir: 'dist', target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
