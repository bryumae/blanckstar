import { defineConfig } from '@playwright/test';

// Real-browser smoke tests against the Vite dev server. Runs separately from
// `npm test` (the vitest/happy-dom unit layer).
//
// Setup once per machine: `npx playwright install chromium firefox webkit`.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
