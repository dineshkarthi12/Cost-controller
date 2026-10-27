import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real API and web app against a dedicated, freshly seeded
 * database (E2E_DATABASE_URL, name must end in _e2e). They never touch the demo database.
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://toprock:toprock@localhost:5432/toprock_e2e';
process.env.E2E_DATABASE_URL = E2E_DB;
const API_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: [
    {
      // Prepares the e2e database first (Playwright starts web servers before any global setup).
      command: 'npx tsx ../../e2e/prepare-db.ts && npx tsx src/server.ts',
      cwd: './apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { DATABASE_URL: E2E_DB, API_PORT: String(API_PORT), NODE_ENV: 'test', CORS_ORIGINS: `http://localhost:${WEB_PORT}`, APP_BASE_URL: `http://localhost:${WEB_PORT}`, STORAGE_DIR: './storage-e2e' },
      reuseExistingServer: false,
      timeout: 600_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: './apps/web',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
