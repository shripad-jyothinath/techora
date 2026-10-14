import { defineConfig } from '@playwright/test';

/**
 * E2E suite for the Techcora ERP demo.
 *
 * Runs against an ISOLATED test database (data/test.sqlite) on port 3100 —
 * your development data in data/erp.sqlite is never touched. The webServer
 * below starts `node server.js` with those env vars automatically.
 *
 * One auth setup project logs in and stores the session; all specs reuse it.
 * Workers are serial (1) because the specs mutate shared data; each spec
 * resets to a known state in beforeAll.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    storageState: 'tests/.auth/admin.json',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.js/,
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
    env: { PORT: '3100', ERP_DB: 'data/test.sqlite' },
  },
});
