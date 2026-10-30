import { defineConfig } from 'vitest/config'

// Plain unit tests with no Nuxt runtime: the contrast of the tokens is read from the CSS file itself. The "source" condition as in
// every package (a test that imports a workspace library reads its src/).
export default defineConfig({
  ssr: { resolve: { conditions: ['source'] } },
  test: { name: 'ui', include: ['test/**/*.test.ts'] },
})
