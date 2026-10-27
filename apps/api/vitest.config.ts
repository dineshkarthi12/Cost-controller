import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** Integration tests run against TEST_DATABASE_URL only — never the development or demo database. */
function testDbUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = new URL('../../.env', import.meta.url);
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^TEST_DATABASE_URL="?([^"\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error('TEST_DATABASE_URL is not set');
}

const url = testDbUrl();
// Global setup runs in the main process, which does not receive test.env.
process.env.TEST_DATABASE_URL = url;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: url, TEST_DATABASE_URL: url, STORAGE_DIR: './storage-test' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
