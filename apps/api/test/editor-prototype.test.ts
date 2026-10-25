import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InvalidBlocksResponse, PrototypeDocument, PrototypeUploadResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PROTOTYPE_MAX_UPLOADS, sniffImage } from '../src/services/editor-prototype.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { startAuthApp } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('editor-prototype')

const DOCUMENT = '/api/v1/prototype/editor/document'
const UPLOADS = '/api/v1/prototype/editor/uploads'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

const paragraph = (id: string, content: unknown = [{ type: 'text', text: 'Hei', marks: [{ type: 'bold' }] }]) => ({
  id,
  type: 'core/paragraph',
  version: 1,
  attrs: { content },
  children: [],
})

const VALID = [
  paragraph('b_p0000001'),
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
        children: [
          { id: 'b_img00001', type: 'core/image', version: 1, attrs: { url: '/api/v1/x.png', alt: 'A' }, children: [] },
        ],
      },
      { id: 'b_col00002', type: 'core/column', version: 1, attrs: {}, children: [paragraph('b_p0000002')] },
    ],
  },
]

describe('sniffImage', () => {
  it('finds the type from the bytes, and refuses SVG and HTML', () => {
    expect(sniffImage(PNG)?.type).toBe('image/png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe('jpg')
    expect(sniffImage(new TextEncoder().encode('GIF89a'))?.extension).toBe('gif')
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.extension).toBe('webp')
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)"/>'))).toBeUndefined()
    expect(sniffImage(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeUndefined()
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('the editor prototype endpoints (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let uploadDir: string

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'toascribe-prototype-test-'))
    env = await startAuthApp({ prototypeUploadDir: uploadDir })
  })
  afterAll(async () => {
    await env.close()
    await rm(uploadDir, { recursive: true, force: true })
  })

  async function signedIn(
    name: string,
    role: 'administrator' | 'editor' | 'author',
  ): Promise<{ client: TestClient; id: string }> {
    const account = await env.createAccount({ username: name, role })
    const client = env.client()
    expect((await client.login(account.username, 'correct horse battery staple')).status).toBe(200)
    return { client, id: account.id }
  }

  function upload(client: TestClient, bytes: Uint8Array, name = 'a.png', csrf = client.csrfToken) {
    const form = new FormData()
    form.append('file', new File([bytes.slice().buffer], name, { type: 'image/png' }))
    return env.app.request(UPLOADS, {
      method: 'POST',
      body: form,
      headers: {
        origin: TEST_ORIGIN,
        'x-real-ip': '203.0.113.7',
        ...(client.cookie === undefined ? {} : { cookie: client.cookie }),
        ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
      },
    })
  }

  it('has no blocks before the first save, then stores and returns them as the own draft of the account', async () => {
    const { client, id } = await signedIn('proto-author', 'author')
    expect(PrototypeDocument.parse(await (await client.get(DOCUMENT)).json())).toEqual({
      id: null,
      blocks: [],
      updatedAt: null,
    })

    const saved = await client.put(DOCUMENT, { blocks: VALID })
    expect(saved.status).toBe(200)
    const document = PrototypeDocument.parse(await saved.json())
    expect(document.id).not.toBeNull()
    // The image's missing caption is stored with its default.
    expect(document.blocks[1]).toMatchObject({
      children: [{ children: [{ attrs: { url: '/api/v1/x.png', alt: 'A', caption: '' } }] }, {}],
    })

    const [row] = await env.query<{ type: string; status: string; account_id: string }>(
      `select c.type, c.status, a.account_id from content c join content_author a on a.content_id = c.id where c.id = $1`,
      [document.id],
    )
    expect(row).toEqual({ type: 'post', status: 'draft', account_id: id })

    const again = await client.put(DOCUMENT, { blocks: [paragraph('b_p0000003')] })
    expect(PrototypeDocument.parse(await again.json()).id).toBe(document.id)
    expect(PrototypeDocument.parse(await (await client.get(DOCUMENT)).json()).blocks).toEqual([paragraph('b_p0000003')])
  })

  it("never shows one account's draft to another (the owner is part of the lookup)", async () => {
    const a = await signedIn('proto-a', 'editor')
    const b = await signedIn('proto-b', 'editor')
    await a.client.put(DOCUMENT, { blocks: [paragraph('b_onlya001')] })
    expect(PrototypeDocument.parse(await (await b.client.get(DOCUMENT)).json()).blocks).toEqual([])
    await b.client.put(DOCUMENT, { blocks: [paragraph('b_onlyb001')] })
    expect(PrototypeDocument.parse(await (await a.client.get(DOCUMENT)).json()).blocks).toEqual([
      paragraph('b_onlya001'),
    ])
  })

  it.each([
    [
      'a script link',
      [
        paragraph('b_bad00001', [
          { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        ]),
      ],
    ],
    ['HTML as content', [paragraph('b_bad00002', '<img src=x onerror=alert(1)>')]],
    ['an HTML node', [paragraph('b_bad00003', [{ type: 'html', html: '<script>alert(1)</script>' }])]],
    ['an unknown block', [{ ...paragraph('b_bad00004'), type: 'core/html' }]],
    [
      'a data: image',
      [{ id: 'b_bad00005', type: 'core/image', version: 1, attrs: { url: 'data:image/svg+xml,<svg/>' }, children: [] }],
    ],
    ['a column at the top', [{ id: 'b_bad00006', type: 'core/column', version: 1, attrs: {}, children: [] }]],
  ])('refuses %s with 400 invalid_blocks and stores nothing', async (_name, blocks) => {
    const { client } = await signedIn(`proto-bad-${String(Math.random()).slice(2, 8)}`, 'author')
    const res = await client.put(DOCUMENT, { blocks })
    expect(res.status).toBe(400)
    const body = InvalidBlocksResponse.parse(await res.json())
    expect(body.error.code).toBe('invalid_blocks')
    expect(body.issues.length).toBeGreaterThan(0)
    expect(PrototypeDocument.parse(await (await client.get(DOCUMENT)).json()).id).toBeNull()
  })

  it('refuses an extra key in the body, a missing CSRF token and another origin', async () => {
    const { client } = await signedIn('proto-csrf', 'author')
    expect((await client.put(DOCUMENT, { blocks: [], title: 'x' })).status).toBe(400)
    expect((await client.put(DOCUMENT, { blocks: [] }, { csrf: 'none' })).status).toBe(403)
    expect((await client.put(DOCUMENT, { blocks: [] }, { origin: 'https://evil.example' })).status).toBe(400)
  })

  it('keeps an uploaded image under a random name and serves it with its type and nosniff', async () => {
    const { client } = await signedIn('proto-upload', 'author')
    const res = await upload(client, PNG, '../../etc/passwd.png')
    expect(res.status).toBe(201)
    const { url } = PrototypeUploadResponse.parse(await res.json())
    expect(url).toMatch(/^\/api\/v1\/prototype\/editor\/uploads\/[0-9a-f-]{36}\.png$/)

    const image = await client.get(url)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(image.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG)

    // Signed out: no image.
    expect((await env.client().get(url)).status).toBe(401)
  })

  it('refuses a file that is not an image of an allowed type, an upload without the CSRF token, and odd names', async () => {
    const { client } = await signedIn('proto-upload-bad', 'editor')
    const svg = await upload(
      client,
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    )
    expect(svg.status).toBe(400)
    expect((await upload(client, PNG, 'a.png', 'wrong')).status).toBe(403)
    for (const name of ['..%2F..%2Fetc%2Fpasswd', 'x.svg', '0198a3c2-0000-7000-8000-0000000000dd.html']) {
      expect((await client.get(`${UPLOADS}/${name}`)).status, name).toBe(404)
    }
  })

  it(`keeps at most ${String(PROTOTYPE_MAX_UPLOADS)} images`, async () => {
    const { client } = await signedIn('proto-many', 'administrator')
    for (let n = 0; n < PROTOTYPE_MAX_UPLOADS + 3; n += 1) {
      expect((await upload(client, PNG)).status).toBe(201)
    }
    expect((await readdir(uploadDir)).length).toBeLessThanOrEqual(PROTOTYPE_MAX_UPLOADS)
  })
})
