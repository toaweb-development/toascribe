import { describe, expect, it } from 'vitest'

import { UI_PACKAGE } from '../src/index.ts'

describe('ui placeholder', () => {
  it('exports its package name', () => {
    expect(UI_PACKAGE).toBe('@toascribe/ui')
  })
})
