import { describe, expect, it } from 'vitest'

import { BlockDefinition, CORE_BLOCKS, canContain, getBlockDefinition, insertableBlocks } from '../src/index.ts'

describe('the core block.json files', () => {
  it('are the four blocks of the prototype, each valid against the definition schema', () => {
    expect(CORE_BLOCKS.map((block) => block.name)).toEqual([
      'core/paragraph',
      'core/image',
      'core/columns',
      'core/column',
    ])
    for (const block of CORE_BLOCKS) {
      expect(BlockDefinition.safeParse(block).success).toBe(true)
    }
  })

  it('refuses a definition with a JSON Schema keyword the validator does not check (fail closed)', () => {
    const paragraph = getBlockDefinition('core/paragraph')
    const withPattern = {
      ...paragraph,
      attributes: { content: { type: 'string', default: '', maxLength: 10, pattern: '^a' } },
    }
    expect(BlockDefinition.safeParse(withPattern).success).toBe(false)
    const unknownField = { ...paragraph, render: 'x' }
    expect(BlockDefinition.safeParse(unknownField).success).toBe(false)
  })
})

describe('canContain (parent and allowedBlocks)', () => {
  it.each([
    [null, 'core/paragraph', true],
    [null, 'core/image', true],
    [null, 'core/columns', true],
    [null, 'core/column', false],
    ['core/columns', 'core/column', true],
    ['core/columns', 'core/paragraph', false],
    ['core/column', 'core/paragraph', true],
    ['core/column', 'core/image', true],
    ['core/column', 'core/columns', false],
    ['core/column', 'core/column', false],
    ['core/paragraph', 'core/paragraph', false],
    [null, 'core/unknown', false],
    ['core/unknown', 'core/paragraph', false],
  ])('%s takes %s: %s', (parent, child, expected) => {
    expect(canContain(parent, child)).toBe(expected)
  })

  it('offers the blocks that fit a place', () => {
    expect(insertableBlocks(null).map((block) => block.name)).toEqual(['core/paragraph', 'core/image', 'core/columns'])
    expect(insertableBlocks('core/column').map((block) => block.name)).toEqual(['core/paragraph', 'core/image'])
  })
})
