import { defineConfig } from 'vitest/config'

// A plain unit test of the API layer with a fake fetcher: no Nuxt runtime, so it starts fast.
export default defineConfig({
  test: { name: 'admin', include: ['test/**/*.test.ts'] },
})
