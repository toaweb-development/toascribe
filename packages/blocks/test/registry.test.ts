import { describe, expect, it } from 'vitest'

import { BlockDefinition, CORE_BLOCKS, canContain, getBlockDefinition, insertableBlocks } from '../src/index.ts'

describe('the core block.json files', () => {
  it('are the basic set of M1.3, the Query Loop of M1.4, the global set of M1.5 and the embed of M1.6, each valid against the definition schema', () => {
    expect(CORE_BLOCKS.map((block) => block.name)).toEqual([
      'core/paragraph',
      'core/heading',
      'core/list',
      'core/list-item',
      'core/quote',
      'core/code',
      'core/preformatted',
      'core/table',
      'core/image',
      'core/gallery',
      'core/buttons',
      'core/button',
      'core/columns',
      'core/column',
      'core/group',
      'core/separator',
      'core/spacer',
      'core/more',
      'core/nextpage',
      'core/html',
      'core/query',
      'core/global-set',
      'core/embed',
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
    ['core/column', 'core/columns', true],
    ['core/list', 'core/paragraph', false],
    [null, 'core/list-item', false],
    ['core/list-item', 'core/list', true],
    ['core/buttons', 'core/button', true],
    [null, 'core/button', false],
    ['core/gallery', 'core/image', true],
    ['core/gallery', 'core/paragraph', false],
    ['core/quote', 'core/heading', true],
    ['core/quote', 'core/image', false],
    ['core/group', 'core/more', false],
    ['core/column', 'core/column', false],
    ['core/paragraph', 'core/paragraph', false],
    [null, 'core/unknown', false],
    ['core/unknown', 'core/paragraph', false],
  ])('%s takes %s: %s', (parent, child, expected) => {
    expect(canContain(parent, child)).toBe(expected)
  })

  it('offers the blocks that fit a place', () => {
    const top = insertableBlocks(null).map((block) => block.name)
    expect(top).toContain('core/more')
    expect(top).not.toContain('core/list-item')
    expect(top).not.toContain('core/column')
    expect(top).not.toContain('core/button')
    const inColumn = insertableBlocks('core/column').map((block) => block.name)
    expect(inColumn).toContain('core/columns')
    expect(inColumn).not.toContain('core/more')
    expect(inColumn).not.toContain('core/nextpage')
    expect(insertableBlocks('core/quote').map((block) => block.name)).toEqual([
      'core/paragraph',
      'core/heading',
      'core/list',
    ])
  })
})
