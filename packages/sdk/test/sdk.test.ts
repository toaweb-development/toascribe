import { describe, expect, it } from 'vitest'

import { SDK_VERSION } from '../src/index.ts'

describe('sdk placeholder', () => {
  it('exports SDK_VERSION', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
