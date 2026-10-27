import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workspace libraries are read from src/ (the "source" export condition), so no dist/ is needed. The view tests run in jsdom
  // (axe needs a DOM), where Vitest resolves as for a browser, so the condition is set for that too.
  ssr: { resolve: { conditions: ['source'] } },
  resolve: { conditions: ['source'] },
  test: { name: 'block-views', include: ['test/**/*.test.ts'] },
})
