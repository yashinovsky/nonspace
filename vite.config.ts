import glsl from 'vite-plugin-glsl';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [glsl()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Three.js alone is ~510 KB minified; the 1 MB dist budget is enforced by scripts/check-size.mjs.
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
