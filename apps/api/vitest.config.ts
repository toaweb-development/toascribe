import { defineConfig } from 'vitest/config'

// Tests import the other workspace packages through their built dist/ (package.json exports);
// `pnpm test` builds them first (build:deps).
export default defineConfig({
  test: { name: 'api', include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
})
