import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrototypeUploadResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PROTOTYPE_MAX_UPLOADS, sniffImage } from '../src/services/editor-prototype.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { startAuthApp } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('editor-prototype')

const UPLOADS = '/api/v1/prototype/editor/uploads'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

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

describe.skipIf(TEST_DATABASE_URL === undefined)('the editor prototype uploads (needs TEST_DATABASE_URL)', () => {
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
