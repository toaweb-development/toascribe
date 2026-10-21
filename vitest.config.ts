import { defineConfig } from 'vitest/config'

// Vitest runs from the root with test.projects (TYPESCRIPT_STANDARD_2026 §7).
// A package joins by having its own vitest.config.ts; no edit here is needed.
export default defineConfig({
  test: {
    projects: [
      // Repo-level tests (scripts, config checks). Also keeps Vitest from failing with "No projects were found".
      { test: { name: 'root', include: ['test/**/*.test.ts'] } },
      'apps/*/vitest.config.{ts,mts}',
      'packages/*/vitest.config.{ts,mts}',
      'themes/*/vitest.config.{ts,mts}',
      'cli/vitest.config.{ts,mts}',
    ],
  },
})
