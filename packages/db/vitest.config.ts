import { defineConfig } from 'vitest/config'

// Integration tests against a real PostgreSQL (typescript §6). They skip, with a notice, when
// TEST_DATABASE_URL is not set; see test/helpers.ts.
export default defineConfig({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    // Each file creates its own database and roles on the server; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
