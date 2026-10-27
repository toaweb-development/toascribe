import { defineConfig } from 'vitest/config'

// Plain unit tests with no Nuxt runtime: the theme lookup on fixture folders and the helpers of the components.
export default defineConfig({
  // Read @toascribe/* libraries from src/ (their "source" export condition), so no dist/ is needed.
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'site-core', include: ['test/**/*.test.ts'] },
})
