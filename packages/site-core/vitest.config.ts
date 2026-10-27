import { defineConfig } from 'vitest/config'

// Plain unit tests with no Nuxt runtime: the theme lookup on fixture folders and the helpers of the components.
export default defineConfig({
  // Read @toascribe/* libraries from src/ (their "source" export condition), so no dist/ is needed.
  // The feed tests run in jsdom (its XML parser), where Vitest resolves as for a browser, so the condition is set for that too.
  ssr: { resolve: { conditions: ['source'] } },
  resolve: { conditions: ['source'] },
  test: { name: 'site-core', include: ['test/**/*.test.ts'] },
})
