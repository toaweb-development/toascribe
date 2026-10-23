import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workspace libraries are read from src/ (the "source" export condition), so no dist/ is needed. Every project sets it
  // itself: test.projects do not inherit it, and resolve.conditions alone does not reach Node tests.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // createTestDatabase() waits for the server-wide role lock while the api's own other files hold it, one at a time. The
    // database files together take well over a minute (the setup wizard's, with a real worker, are among them), and the last
    // one in the queue waits for all the others. The root `test` script runs the packages one at a time, so no other package
    // is in that queue; a hook that is really stuck still fails, only later.
    hookTimeout: 240_000,
  },
})
