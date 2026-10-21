import { defineConfig } from 'vitest/config'

// Plain unit tests with no Nuxt runtime, so they start fast. The app has none of its own yet: the API layer and its
// tests live in packages/nuxt-base.
export default defineConfig({
  // Read @toascribe/* libraries from src/ (their "source" export condition), so no dist/ is needed.
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'admin', include: ['test/**/*.test.ts'] },
})
