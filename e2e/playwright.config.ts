import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: './support/global-setup.ts',
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Many specs call POST /__test/seed with strategy: truncate, which wipes the
  // users/sessions tables. Running workers in parallel interleaves those
  // truncations with other specs' setup and produces spurious UNAUTHENTICATED
  // failures. Until the seed endpoint supports per-spec isolation (upsert +
  // scoped cleanup is a WS-08 concern), keep the smoke suite serial.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
