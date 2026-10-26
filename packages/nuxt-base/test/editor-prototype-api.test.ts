import { describe, expect, it, vi } from 'vitest'

import { createEditorPrototypeApi } from '../app/lib/api/editor-prototype.ts'

const ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'

describe('the editor prototype API layer (PROTOTYPE, M0.6)', () => {
  it('uploads a file as multipart form data and accepts only an address under the upload path', async () => {
    const api = vi.fn().mockResolvedValue({ url: `/api/v1/prototype/editor/uploads/${ID}.png` })
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    expect((await createEditorPrototypeApi(api).upload(file)).url).toContain(ID)
    const [path, options] = api.mock.calls[0] as [string, { method: string; body: FormData }]
    expect(path).toBe('/v1/prototype/editor/uploads')
    expect(options.method).toBe('POST')
    expect(options.body.get('file')).toBeInstanceOf(File)

    const evil = vi.fn().mockResolvedValue({ url: 'https://evil.example/x.png' })
    await expect(createEditorPrototypeApi(evil).upload(file)).rejects.toThrow()
  })
})
