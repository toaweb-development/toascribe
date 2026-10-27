import { describe, expect, it, vi } from 'vitest'

import { createMediaApi, mediaQueryString } from '../app/lib/api/media.ts'

const ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'
const ITEM = {
  id: ID,
  title: 'Fjord',
  alt: '',
  caption: '',
  description: '',
  mime: 'image/jpeg',
  group: 'image',
  fileName: 'fjord.jpg',
  size: 10,
  width: 10,
  height: 10,
  visibility: 'public',
  folderId: null,
  uploadedBy: null,
  attachedTo: null,
  processing: 'ready',
  processingError: null,
  url: '/uploads/2026/10/fjord-abcdef01.jpg',
  originalUrl: '/uploads/2026/10/fjord-abcdef01.jpg',
  sizes: [],
  createdAt: '2026-10-26T10:00:00.000Z',
  modifiedAt: '2026-10-26T10:00:00.000Z',
  can: { edit: true, delete: true },
}

describe('the media API layer', () => {
  it('builds the query string from what is set', () => {
    expect(mediaQueryString({})).toBe('')
    expect(mediaQueryString({ search: ' fjord ', group: 'image', folder: 'none', page: 2, per_page: 40 })).toBe(
      'search=fjord&group=image&folder=none&page=2&per_page=40',
    )
  })

  it('sends a file as multipart and the details as JSON, with the right paths', async () => {
    const api = vi.fn().mockResolvedValue(ITEM)
    const media = createMediaApi(api)
    await media.upload(new File([new Uint8Array([1])], 'a.png'), { alt: 'x' })
    await media.update(ID, { alt: 'Fjord' })
    await media.edit(ID, [{ op: 'rotate', degrees: 90 }])
    await media.fromUrl({ url: 'https://example.com/a.png' })
    const [uploadPath, uploadOptions] = api.mock.calls[0] as [string, { method: string; body: FormData }]
    expect([uploadPath, uploadOptions.method, uploadOptions.body.get('alt')]).toEqual(['/v1/media', 'POST', 'x'])
    expect(api.mock.calls.slice(1)).toEqual([
      [`/v1/media/${ID}`, { method: 'PATCH', body: { alt: 'Fjord' } }],
      [`/v1/media/${ID}/edit`, { method: 'POST', body: { operations: [{ op: 'rotate', degrees: 90 }] } }],
      ['/v1/media/from-url', { method: 'POST', body: { url: 'https://example.com/a.png' } }],
    ])
  })

  it('refuses an answer that does not fit the schema', async () => {
    const api = vi.fn().mockResolvedValue({ ...ITEM, processing: 'maybe' })
    await expect(createMediaApi(api).get(ID)).rejects.toThrow()
  })
})
