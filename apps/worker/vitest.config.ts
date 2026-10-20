import { defineConfig } from 'vitest/config'

// Tests import the other workspace packages through their built dist/ (package.json exports);
// `pnpm test` builds them first (build:deps). The database tests create their own database,
// so files run one at a time.
export default defineConfig({
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
