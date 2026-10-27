// The public reading API layer (M1.4): the query string, the paths, and that answers are parsed.
import { describe, expect, it, vi } from 'vitest'

import { createPublicApi, publicQueryString } from '../app/lib/api/public.ts'

describe('the public API layer', () => {
  it('builds the query string from what is set', () => {
    expect(publicQueryString({})).toBe('')
    expect(publicQueryString({ type: 'post', category: 'nyheter', page: 2, search: '', sticky_first: 'true' })).toBe(
      'type=post&category=nyheter&page=2&sticky_first=true',
    )
  })

  it('asks for an address with its path and query, and refuses an answer of the wrong shape', async () => {
    const api = vi.fn().mockResolvedValueOnce({ kind: 'redirect', status: 301, location: '/hei/', cacheTags: [] })
    expect(await createPublicApi(api).resolve('/?p=12')).toMatchObject({ kind: 'redirect', location: '/hei/' })
    expect(api).toHaveBeenCalledWith('/v1/public/resolve?path=%2F%3Fp%3D12')
    await expect(createPublicApi(vi.fn().mockResolvedValueOnce({ kind: 'single' })).resolve('/x/')).rejects.toThrow()
  })

  it('posts the password as JSON, and asks for a preview by its token', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    await createPublicApi(api).unlock('id', 'sesam')
    expect(api).toHaveBeenCalledWith('/v1/public/unlock', {
      method: 'POST',
      body: { contentId: 'id', password: 'sesam' },
    })
    await createPublicApi(api)
      .preview('v1.a.b', 2)
      .catch(() => undefined)
    expect(api).toHaveBeenLastCalledWith('/v1/public/preview?token=v1.a.b&page=2')
  })
})
