import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against the compose stack with the Mailpit profile (e2e/README.md). They are not part of `pnpm check`: they
// need Docker and a running stack. Everything the tests need is passed in environment variables (`e2e/stack.sh env` prints them).
//
// `localhost`, not 127.0.0.1: the session cookie is `__Host-` prefixed and `Secure`, which Chromium accepts on http://localhost
// only. The tests run one after another because they share the stack: its settings, its mail box and its login limits.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:18080'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  reporter: [['list']],
  outputDir: 'node_modules/.cache/playwright-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The two widths the screens are checked at: a phone (375 px) and a desktop (1280 px).
    { name: 'phone-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 740 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
