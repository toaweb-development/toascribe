import { defineConfig } from 'vitest/config'

// Integration tests against a real PostgreSQL (typescript §6). They skip, with a notice, when TEST_DATABASE_URL is not set;
// see test/db.ts.
export default defineConfig({
  // Workspace libraries are read from src/ (the "source" export condition), so no dist/ is needed. Every project sets it
  // itself: test.projects do not inherit it, and resolve.conditions alone does not reach Node tests.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'install',
    include: ['test/**/*.test.ts'],
    // Each file creates its own database and roles on the server; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
