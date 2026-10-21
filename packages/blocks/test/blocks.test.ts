import { describe, expect, it } from 'vitest'

import { BLOCKS_PACKAGE } from '../src/index.ts'

describe('blocks placeholder', () => {
  it('exports its package name', () => {
    expect(BLOCKS_PACKAGE).toBe('@toascribe/blocks')
  })
})
