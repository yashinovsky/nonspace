import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import glsl from 'vite-plugin-glsl';
import { defineConfig, type Plugin } from 'vitest/config';

const ROOT = dirname(fileURLToPath(import.meta.url));

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function gitShortSha(): string {
  const env = process.env.GITHUB_SHA ?? process.env.VITE_GIT_SHA;
  if (env && env.length >= 7) return env.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** Netlify / Cloudflare Pages cache map. GitHub Pages ignores this file. */
const RELEASE_HEADERS = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '',
  '/index.html',
  '  Cache-Control: no-cache',
  '',
  '/',
  '  Cache-Control: no-cache',
  '',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n');

/** Emit `_headers` + `.nojekyll` into dist/ for the static Pages deploy. */
function releaseStatic(): Plugin {
  return {
    name: 'release-static',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: RELEASE_HEADERS });
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
    },
  };
}

/**
 * Collapse GLSL while keeping preprocessor directives (`#include`, `#ifdef`, …)
 * on their own lines — Three.js WebGLProgram requires that.
 */
function minifyGlsl(src: string): string {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const parts: string[] = [];
  for (const raw of stripped.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('#')) {
      parts.push(`\n${t.replace(/\s+/g, ' ')}\n`);
      continue;
    }
    parts.push(t.replace(/\s+/g, ' ').replace(/\s*([{}();,=+\-*/<>])\s*/g, '$1'));
  }
  return parts.join('').replace(/\n+/g, '\n').trim();
}

function looksLikeGlsl(src: string): boolean {
  return (
    /#include\s*</.test(src) ||
    /#ifdef\s+\w/.test(src) ||
    /void\s+main\s*\(/.test(src) ||
    /gl_(?:FragColor|Position|FragCoord)/.test(src) ||
    /precision\s+(?:highp|mediump)\s+float/.test(src)
  );
}

function minifyGlslInJs(code: string): string {
  let next = code.replace(/"(?:\\.|[^"\\])*"/g, (quoted) => {
    if (!quoted.includes('\\n') && !quoted.includes('#include')) return quoted;
    let inner: string;
    try {
      inner = JSON.parse(quoted) as string;
    } catch {
      return quoted;
    }
    if (!looksLikeGlsl(inner)) return quoted;
    return JSON.stringify(minifyGlsl(inner));
  });
  next = next.replace(/`(?:\\`|[^`])*`/g, (tmpl) => {
    if (tmpl.includes('${')) return tmpl;
    const inner = tmpl.slice(1, -1);
    if (!looksLikeGlsl(inner)) return tmpl;
    return JSON.stringify(minifyGlsl(inner));
  });
  return next;
}

/** Collapse `?raw` shader imports (e.g. rasterCrt.frag) on production builds. */
function minifyRawGlsl(): Plugin {
  return {
    name: 'minify-raw-glsl',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('?raw')) return;
      if (!/\.(frag|vert|glsl)(?:\?|$)/.test(id)) return;
      const wrapped = /^export\s+default\s+("(?:\\.|[^"\\])*")\s*;?\s*$/.exec(code);
      if (!wrapped) return;
      const inner = JSON.parse(wrapped[1]!) as string;
      return { code: `export default ${JSON.stringify(minifyGlsl(inner))};`, map: null };
    },
  };
}

/** Three.js ShaderChunk / PMREM strings keep comments and tabs; strip them in dist. */
function minifyThreeGlsl(): Plugin {
  return {
    name: 'minify-three-glsl',
    apply: 'build',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.includes('/node_modules/three/')) return;
      if (!/\.(?:js|mjs|cjs)$/.test(file)) return;
      const next = minifyGlslInJs(code);
      if (next === code) return;
      return { code: next, map: null };
    },
  };
}

export default defineConfig(({ command }) => ({
  // Relative base so hashed assets resolve under GitHub Pages `/<repo>/`.
  base: './',
  define: {
    __NONSPACE_VERSION__: JSON.stringify(packageVersion()),
    __NONSPACE_SHA__: JSON.stringify(gitShortSha()),
  },
  plugins: [
    // Minify GLSL on `vite build` so look-lane shaders stay inside the 1 MB dist budget.
    glsl({ minify: command === 'build' }),
    minifyRawGlsl(),
    minifyThreeGlsl(),
    releaseStatic(),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Three.js alone is ~510 KB minified; the 1 MB default-boot budget is enforced by scripts/check-size.mjs.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Content hashes so `/assets/*` can be cached immutable; HTML stays no-cache.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
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
}));
