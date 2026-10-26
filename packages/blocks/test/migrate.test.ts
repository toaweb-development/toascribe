import { describe, expect, it } from 'vitest'

import { documentMediaRefs, legacyImageUrls, migrateDocument, validateDocument } from '../src/index.ts'

const MEDIA = '01a15f9a-26a2-73d3-8aad-c6b671836b33'

/** An image block as the M0.6 prototype stored it (version 1, with an address). */
const v1 = (id: string, url: string, alt = 'Fjord') => ({
  id,
  type: 'core/image',
  version: 1,
  attrs: { url, alt, caption: 'Bildetekst' },
  children: [],
})

const known: Record<string, string> = { '/uploads/2026/10/fjord-abcdef01.jpg': MEDIA }
const context = { mediaIdForUrl: (url: string) => known[url] }

describe('migrateDocument (core/image 1 → 2)', () => {
  it('upgrades a stored image with an address the library knows to its media id, keeping the alt text and caption', () => {
    const stored = [v1('b_img00001', '/uploads/2026/10/fjord-abcdef01.jpg')]
    const { blocks, changed } = migrateDocument(stored, context)
    expect(changed).toBe(true)
    expect(blocks).toEqual([
      {
        id: 'b_img00001',
        type: 'core/image',
        version: 2,
        attrs: { mediaId: MEDIA, alt: 'Fjord', caption: 'Bildetekst', decorative: false },
        children: [],
      },
    ])
    expect(validateDocument(blocks).ok).toBe(true)
  })

  it('leaves an outside address without an image, also inside columns, and changes nothing else', () => {
    const stored = [
      {
        id: 'b_cols0001',
        type: 'core/columns',
        version: 1,
        attrs: {},
        children: [
          {
            id: 'b_col00001',
            type: 'core/column',
            version: 1,
            attrs: {},
            children: [v1('b_img00002', 'https://example.com/x.png')],
          },
          { id: 'b_col00002', type: 'core/column', version: 1, attrs: {}, children: [] },
        ],
      },
    ]
    const { blocks } = migrateDocument(stored, context)
    expect(blocks).toMatchObject([
      { children: [{ children: [{ version: 2, attrs: { mediaId: '', alt: 'Fjord' } }] }, {}] },
    ])
    expect(validateDocument(blocks).ok).toBe(true)
  })

  it('returns the same array when there is nothing to do, and lists the addresses it will look up', () => {
    const current = [{ id: 'b_p0000001', type: 'core/paragraph', version: 1, attrs: { content: [] }, children: [] }]
    expect(migrateDocument(current, context)).toEqual({ blocks: current, changed: false })
    expect(legacyImageUrls([v1('b_a00001', '/a.png'), v1('b_a00002', '/a.png'), v1('b_a00003', '')])).toEqual([
      '/a.png',
    ])
  })

  it('lists the media a document uses, with the block that holds each', () => {
    const { blocks } = migrateDocument([v1('b_img00009', '/uploads/2026/10/fjord-abcdef01.jpg')], context)
    const checked = validateDocument(blocks)
    expect(checked.ok && documentMediaRefs(checked.blocks)).toEqual([{ mediaId: MEDIA, blockId: 'b_img00009' }])
  })
})
