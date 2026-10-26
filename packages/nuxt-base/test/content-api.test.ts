import { describe, expect, it, vi } from 'vitest'

import { contentQueryString, createContentApi } from '../app/lib/api/content.ts'

const ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'

const ITEM = {
  id: ID,
  shortId: 7,
  shortLink: '/?p=7',
  type: 'post',
  locale: 'nb',
  title: 'Hei',
  slug: 'hei',
  status: 'draft',
  statusBeforeTrash: null,
  visibility: 'public',
  sticky: false,
  commentStatus: 'open',
  parentId: null,
  menuOrder: 0,
  template: null,
  publishedAt: null,
  unpublishAt: null,
  createdAt: '2026-10-26T10:00:00.000Z',
  modifiedAt: '2026-10-26T10:00:00.000Z',
  authors: [{ id: ID, username: 'tor', displayName: 'Tor' }],
  categories: [],
  tags: [],
  can: { edit: true, delete: true, publish: true, editOthers: true },
  excerpt: '',
  blocks: [],
  blocksFormat: 'blocks',
  media: [],
}

describe('the content query string', () => {
  it('sends the type first and only what is set; «all» and an empty search are left out', () => {
    expect(contentQueryString({ type: 'post' })).toBe('type=post')
    expect(contentQueryString({ type: 'post', status: 'all', search: '  ' })).toBe('type=post')
    expect(
      contentQueryString({ type: 'page', status: 'trash', search: ' a&b ', month: '2026-10', page: 2, per_page: 50 }),
    ).toBe('type=page&status=trash&search=a%26b&month=2026-10&page=2&per_page=50')
  })
})

describe('the content API layer', () => {
  it('reads, makes, changes and acts with the right method and path, and parses the answers', async () => {
    const api = vi.fn().mockResolvedValue(ITEM)
    const content = createContentApi(api)
    expect((await content.get(ID)).slug).toBe('hei')
    await content.create({ type: 'post', title: 'Hei' })
    await content.update(ID, { title: 'Hallo' })
    await content.publish(ID)
    await content.trash(ID)
    await content.restore(ID)
    expect(api.mock.calls).toEqual([
      [`/v1/content/${ID}`],
      ['/v1/content', { method: 'POST', body: { type: 'post', title: 'Hei' } }],
      [`/v1/content/${ID}`, { method: 'PATCH', body: { title: 'Hallo' } }],
      [`/v1/content/${ID}/publish`, { method: 'POST' }],
      [`/v1/content/${ID}/trash`, { method: 'POST' }],
      [`/v1/content/${ID}/restore`, { method: 'POST' }],
    ])
  })

  it('deletes with DELETE and sends bulk actions as they are', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ changed: [ID], unchanged: [], skipped: [] })
    const content = createContentApi(api)
    await content.remove(ID)
    expect((await content.bulk({ action: 'trash', ids: [ID] })).changed).toEqual([ID])
    expect(api).toHaveBeenNthCalledWith(1, `/v1/content/${ID}`, { method: 'DELETE' })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/content/bulk', { method: 'POST', body: { action: 'trash', ids: [ID] } })
  })

  it('refuses an answer that does not fit the schema', async () => {
    const api = vi.fn().mockResolvedValue({ ...ITEM, status: 'deleted' })
    await expect(createContentApi(api).get(ID)).rejects.toThrow()
  })
})
