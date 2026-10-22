import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workspace libraries are read from src/ (the "source" export condition), so no dist/ is needed. Every project sets it
  // itself: test.projects do not inherit it, and resolve.conditions alone does not reach Node tests.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // createTestDatabase() waits for the server-wide role lock while the db, worker and cli tests (and the api's own other
    // files) hold it, one file at a time; with every account flow tested against a real database that queue is long.
    hookTimeout: 300_000,
  },
})
