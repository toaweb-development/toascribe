import { describe, expect, it } from 'vitest'

import { getBlockDefinition, validateAttrs, validateDocument } from '../src/index.ts'
import { col, cols, img, p } from './fixtures.ts'

const raw = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('validateDocument (the editor before saving, the api before storing)', () => {
  it('accepts a document with columns, an image and paragraphs, and fills in default attributes', () => {
    const document = [p('b_p001', 'Hei'), cols('b_cs01', col('b_c001', img('b_i001')), col('b_c002', p('b_p002')))]
    const result = validateDocument(raw(document))
    expect(result).toEqual({ ok: true, blocks: document })

    const missingAttrs = validateDocument([
      { id: 'b_p001', type: 'core/paragraph', version: 1, attrs: {}, children: [] },
    ])
    expect(missingAttrs).toEqual({ ok: true, blocks: [p('b_p001')] })
  })

  it('accepts the empty document', () => {
    expect(validateDocument([])).toEqual({ ok: true, blocks: [] })
  })

  it.each([
    ['not an array', { blocks: [] }, 'invalid_shape', []],
    ['an extra key on a block', [{ ...p('b_p001'), html: '<p>x</p>' }], 'invalid_shape', [0]],
    ['a missing key', [{ id: 'b_p001', type: 'core/paragraph', version: 1, attrs: {} }], 'invalid_shape', [0]],
    ['a bad id', [p('x')], 'invalid_id', [0, 'id']],
    ['a duplicate id', [p('b_p001'), p('b_p001')], 'duplicate_id', [1, 'id']],
    ['an unknown type', [{ ...p('b_p001'), type: 'core/classic' }], 'unknown_block', [0, 'type']],
    ['an old version', [{ ...p('b_p001'), version: 2 }], 'unsupported_version', [0, 'version']],
    ['a column at the top level', [col('b_c001')], 'not_allowed_here', [0, 'type']],
    [
      'a paragraph straight in columns',
      [cols('b_cs01', p('b_p001'), col('b_c001'))],
      'not_allowed_here',
      [0, 'children', 0, 'type'],
    ],
    [
      'a column in a column',
      [cols('b_cs01', col('b_c001', col('b_c002')), col('b_c004'))],
      'not_allowed_here',
      [0, 'children', 0, 'children', 0, 'type'],
    ],
    ['a list item outside a list', [{ ...p('b_p001'), type: 'core/list-item' }], 'not_allowed_here', [0, 'type']],
    ['one column', [cols('b_cs01', col('b_c001'))], 'child_count', [0, 'children']],
    [
      'five columns',
      [cols('b_cs01', ...['1', '2', '3', '4', '5'].map((n) => col(`b_c00${n}`)))],
      'child_count',
      [0, 'children'],
    ],
    [
      'a child in a paragraph',
      [{ ...p('b_p001'), children: [p('b_p002')] }],
      'not_allowed_here',
      [0, 'children', 0, 'type'],
    ],
    [
      'an unknown attribute',
      [{ ...p('b_p001'), attrs: { content: [], style: 'x' } }],
      'unknown_attribute',
      [0, 'attrs', 'style'],
    ],
    [
      'an address instead of a media id',
      [img('b_i001', 'javascript:alert(1)')],
      'invalid_attribute',
      [0, 'attrs', 'mediaId'],
    ],
    [
      'an image address (version 1)',
      [{ ...img('b_i001'), attrs: { url: '/a.png' } }],
      'unknown_attribute',
      [0, 'attrs', 'url'],
    ],
    [
      'alt text that is not a string',
      [{ ...img('b_i001'), attrs: { mediaId: '', alt: 5, caption: '' } }],
      'invalid_attribute',
      [0, 'attrs', 'alt'],
    ],
    [
      'an image without alt text that is not decorative',
      [{ ...img('b_i001'), attrs: { mediaId: '01a15f9a-26a2-73d3-8aad-c6b671836b33', alt: '  ' } }],
      'alt_required',
      [0, 'attrs', 'alt'],
    ],
    [
      'HTML as paragraph content',
      [{ ...p('b_p001'), attrs: { content: '<script>alert(1)</script>' } }],
      'invalid_attribute',
      [0, 'attrs', 'content'],
    ],
    [
      'a script link in a paragraph',
      [
        {
          ...p('b_p001'),
          attrs: { content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }] },
        },
      ],
      'invalid_attribute',
      [0, 'attrs', 'content', 0, 'marks', 0, 'attrs', 'href'],
    ],
  ])('refuses %s', (_name, input, code, path) => {
    const result = validateDocument(raw(input))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code, path }))
    }
  })

  it('reports every issue, not only the first', () => {
    const result = validateDocument(raw([img('b_i001', 'javascript:x'), p('b_p001'), p('b_p001'), col('b_c001')]))
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toEqual([
      'invalid_attribute',
      'duplicate_id',
      'not_allowed_here',
    ])
  })

  it('refuses a document nested too deep or too large', () => {
    const deep = { ...p('b_p001'), children: [] as unknown[] }
    let node: { children: unknown[] } = deep
    for (let level = 0; level < 10; level += 1) {
      const child = { ...p(`b_d${String(level).padStart(3, '0')}`), children: [] as unknown[] }
      node.children.push(child)
      node = child
    }
    const nested = validateDocument([deep])
    expect(nested.ok ? [] : nested.issues.map((issue) => issue.code)).toContain('too_large')

    const many = Array.from({ length: 5001 }, (_, index) => p(`b_${String(index).padStart(6, '0')}`))
    expect(validateDocument(raw(many))).toMatchObject({ ok: false, issues: [{ code: 'too_large' }] })
    // Also when they are all inside one top-level block: the walk stops at the cap.
    const wide = [{ ...p('b_wide0001'), children: many }]
    expect(validateDocument(raw(wide))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'too_large', message: 'Too many blocks' }],
    })
  })
})

describe('validateAttrs', () => {
  it('checks the length limits of block.json', () => {
    const image = getBlockDefinition('core/image')
    if (image === undefined) throw new Error('no image block')
    expect(validateAttrs(image, { alt: 'a'.repeat(1000) }).ok).toBe(true)
    expect(validateAttrs(image, { alt: 'a'.repeat(1001) }).ok).toBe(false)
    expect(validateAttrs(image, null).ok).toBe(false)
  })
})
