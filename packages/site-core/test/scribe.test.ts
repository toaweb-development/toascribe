// The helpers of the catch-all route and the core components (M1.4).
import { createBlock } from '@toascribe/blocks'
import { describe, expect, it } from 'vitest'

import { addressOf, archivePage, isLocalPath, itemPage, pageBlocks, pickTemplate } from '../app/lib/scribe.ts'

describe('the catch-all helpers', () => {
  it('asks the api with only the query it reads, or for a preview link', () => {
    expect(addressOf({ path: '/hei/', query: { utm_source: 'x' } })).toEqual({ kind: 'resolve', path: '/hei/' })
    expect(addressOf({ path: '/', query: { s: 'fjell', p: '12' } })).toEqual({
      kind: 'resolve',
      path: '/?s=fjell&p=12',
    })
    expect(addressOf({ path: '/', query: { preview: 'v1.a.b', page: '2' } })).toEqual({
      kind: 'preview',
      token: 'v1.a.b',
      page: 2,
    })
    expect(addressOf({ path: '/', query: { preview: 'v1.a.b', page: 'x' } })).toMatchObject({ page: 1 })
  })

  it('splits a post at its page breaks', () => {
    const blocks = [
      createBlock('core/paragraph'),
      createBlock('core/nextpage'),
      createBlock('core/heading'),
      createBlock('core/paragraph'),
    ]
    expect(pageBlocks(blocks, 1).map((block) => block.type)).toEqual(['core/paragraph'])
    expect(pageBlocks(blocks, 2).map((block) => block.type)).toEqual(['core/heading', 'core/paragraph'])
    expect(pageBlocks(blocks, 3)).toEqual([])
  })

  it("makes WordPress' addresses of archive and item pages", () => {
    expect(archivePage('/category/mat/page/3/', 2)).toBe('/category/mat/page/2/')
    expect(archivePage('/category/mat/page/3/', 1)).toBe('/category/mat/')
    expect(archivePage('/page/2/', 3, 'fjell og hav')).toBe('/page/3/?s=fjell+og+hav')
    expect(itemPage('/hei/', 2)).toBe('/hei/2/')
    expect(itemPage('/', 2)).toBe('/2/')
  })

  it('picks the first template the theme has, and index last', () => {
    const available = { single: 'S', index: 'I' }
    expect(pickTemplate(['single-post-hei', 'single', 'index'], available)).toBe('S')
    expect(pickTemplate(['404'], available)).toBe('I')
  })

  it('follows a redirect to a path on the site only', () => {
    expect(isLocalPath('/hei/')).toBe(true)
    for (const location of ['//evil.example/', '/\\evil.example', 'https://evil.example/']) {
      expect(isLocalPath(location)).toBe(false)
    }
  })
})
