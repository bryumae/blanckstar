import { defineConfig } from '@playwright/test';

// Real-browser smoke tests against the Vite dev server. Runs separately from
// `npm test` (the vitest/happy-dom unit layer).
//
// Setup once per machine: `npx playwright install chromium firefox webkit`.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // CI hardening: the GitHub ubuntu runner drives headless Firefox far slower
  // than a dev box, and three browsers hammering one Vite dev server (on-demand
  // transforms + the Three.js/WebGL telescope) turned tight default timeouts
  // into consistent Firefox timeouts. Serialize workers so the dev server serves
  // one browser at a time, give async-mounted UI more room, and retry to absorb
  // residual runner flake. Locally these are unchanged (fast, parallel).
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
