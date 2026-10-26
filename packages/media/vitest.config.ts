import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workspace libraries are read from src/ (the "source" export condition), so no dist/ is needed. Every project sets it
  // itself: test.projects do not inherit it, and resolve.conditions alone does not reach Node tests.
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'media', include: ['test/**/*.test.ts'] },
})
