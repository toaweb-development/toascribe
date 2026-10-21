import { defineConfig } from 'vitest/config'

// Plain unit tests with no Nuxt runtime (a fake fetcher, the message files), so they start fast.
export default defineConfig({
  // Read @toascribe/shared from src/ (its "source" export condition), so no dist/ is needed.
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'nuxt-base', include: ['test/**/*.test.ts'] },
})
