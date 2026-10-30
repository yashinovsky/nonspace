import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

const swiftshaderUse = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    // Headless Chromium has no GPU in CI; SwiftShader provides WebGL2 in software.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Two SwiftShader workers starve loop.spec (CPU throttle) and sky.spec (40k
  // spin) once quality.spec joins the a11y suite. One worker in CI; quality.spec
  // also runs in a follow-on project so it cannot shift the main shard.
  ...(process.env.CI ? { workers: 1 } : {}),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-swiftshader',
      testIgnore: /quality\.spec\.ts/,
      use: swiftshaderUse,
    },
    {
      name: 'chromium-swiftshader-quality',
      testMatch: /quality\.spec\.ts/,
      dependencies: ['chromium-swiftshader'],
      use: swiftshaderUse,
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
