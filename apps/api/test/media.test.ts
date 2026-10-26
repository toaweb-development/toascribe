// The media library through the api (M1.2): uploads of every kind of file the library takes and the ones it refuses (SVG, a false
// extension, too large, too many pixels), private files, replace and edit, the jobs it queues for the worker, «Brukes på», folders,
// Settings → Media, and the upgrade of a stored image block from an address to a media id. The worker's own work (the sizes) is
// tested in apps/worker.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ContentItem, MediaDetail, MediaFolderListResponse, MediaItem, MediaListResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import * as f from './media-fixtures.ts'

noticeIfSkipped('media')

describe.skipIf(TEST_DATABASE_URL === undefined)('the media library (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let editor: TestClient
  let author: TestClient
  let other: TestClient
  let authorId: string

  beforeAll(async () => {
    env = await startAuthApp({ uploadCapMb: 2 })
    await env.createAccount({ username: 'm-editor', role: 'editor' })
    authorId = (await env.createAccount({ username: 'm-author', role: 'author' })).id
    await env.createAccount({ username: 'm-other', role: 'author' })
    editor = env.client()
    author = env.client({ ip: '203.0.113.21' })
    other = env.client({ ip: '203.0.113.22' })
    expect((await editor.login('m-editor', TEST_PASSWORD)).status).toBe(200)
    expect((await author.login('m-author', TEST_PASSWORD)).status).toBe(200)
    expect((await other.login('m-other', TEST_PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await env.close()
  })

  /** A multipart request as the browser sends it, with the client's session and CSRF token. */
  function multipart(
    client: TestClient,
    path: string,
    file: { bytes: Uint8Array; name: string },
    fields: Record<string, string> = {},
  ) {
    const form = new FormData()
    form.append('file', new File([file.bytes.slice().buffer], file.name))
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    return env.app.request(path, {
      method: 'POST',
      body: form,
      headers: {
        origin: TEST_ORIGIN,
        'x-real-ip': '203.0.113.30',
        ...(client.cookie === undefined ? {} : { cookie: client.cookie }),
        ...(client.csrfToken === undefined ? {} : { 'x-csrf-token': client.csrfToken }),
      },
    })
  }

  async function upload(
    client: TestClient,
    bytes: Uint8Array,
    name: string,
    fields: Record<string, string> = {},
  ): Promise<MediaItem> {
    const res = await multipart(client, '/api/v1/media', { bytes, name }, fields)
    expect(res.status, `${name}: ${await res.clone().text()}`).toBe(201)
    return MediaItem.parse(await res.json())
  }

  async function code(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code
  }

  describe('uploads', () => {
    it.each([
      ['bilde.png', f.PNG, 'image', 'pending'],
      ['bilde.jpg', f.JPEG, 'image', 'pending'],
      ['bilde.gif', f.GIF, 'image', 'pending'],
      ['bilde.webp', f.WEBP, 'image', 'pending'],
      ['bilde.tif', f.TIFF_1X1, 'image', 'pending'],
      ['bilde.bmp', f.BMP, 'image', 'ready'],
      ['favicon.ico', f.ICO, 'image', 'ready'],
      ['dok.pdf', f.PDF, 'document', 'ready'],
      ['dok.rtf', f.RTF, 'document', 'ready'],
      ['dok.docx', f.DOCX, 'document', 'ready'],
      ['regneark.xlsx', f.XLSX, 'spreadsheet', 'ready'],
      ['tekst.odt', f.ODT, 'document', 'ready'],
      ['arkiv.zip', f.ZIP, 'archive', 'ready'],
      ['arkiv.gz', f.GZ, 'archive', 'ready'],
      ['lyd.mp3', f.MP3, 'audio', 'ready'],
      ['lyd.wav', f.WAV, 'audio', 'ready'],
      ['lyd.ogg', f.OGG, 'audio', 'ready'],
      ['lyd.flac', f.FLAC, 'audio', 'ready'],
      ['film.mp4', f.MP4, 'video', 'ready'],
      ['data.csv', f.TEXT, 'text', 'ready'],
      ['notat.txt', f.TEXT, 'text', 'ready'],
    ])(
      'takes %s (%s), stores it under a key the server chose, and queues the sizes of an image',
      async (name, bytes, group, processing) => {
        const before = env.mediaJobs.jobs.length
        const item = await upload(author, bytes, name)
        expect(item).toMatchObject({ group, processing, fileName: name, size: bytes.length, visibility: 'public' })
        expect(item.originalUrl).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[a-z0-9-]+-[0-9a-f]{8}\.[a-z0-9]+$/)
        expect(env.mediaJobs.jobs.slice(before)).toEqual(
          processing === 'pending' ? [{ kind: 'process', mediaId: item.id }] : [],
        )
        // The public file is served as it was uploaded.
        const served = await env.client().get(item.originalUrl)
        expect(served.status).toBe(200)
        expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes)
        expect(served.headers.get('x-content-type-options')).toBe('nosniff')
        expect(served.headers.get('content-disposition')).toMatch(
          group === 'image' && !['bilde.tif', 'bilde.bmp', 'favicon.ico'].includes(name) ? /^inline/ : /^attachment/,
        )
      },
    )

    it.each([
      ['an SVG', f.SVG, 'bilde.svg', 400, 'unsupported_type'],
      ['an SVG named .png', f.SVG, 'bilde.png', 400, 'type_mismatch'],
      ['a PNG named .jpg', f.PNG, 'bilde.jpg', 400, 'type_mismatch'],
      [
        'a page named .txt',
        new TextEncoder().encode('<html><script>alert(1)</script></html>'),
        'notat.txt',
        400,
        'type_mismatch',
      ],
      ['a script', new TextEncoder().encode('alert(1)'), 'kode.js', 400, 'unsupported_type'],
      ['an empty file', new Uint8Array(), 'tom.png', 400, 'empty_file'],
      ['a TIFF whose size cannot be read', f.TIFF, 'uleselig.tif', 400, 'unreadable_image'],
      [
        'a decompression bomb (60 000 × 60 000 in the header)',
        f.pngClaiming(60_000, 60_000),
        'bombe.png',
        400,
        'image_too_large',
      ],
    ])('refuses %s', async (_what, bytes, name, status, reason) => {
      const res = await multipart(author, '/api/v1/media', { bytes, name })
      expect([res.status, await code(res)]).toEqual([status, reason])
    })

    it('refuses a file above the upload limit, from the setting as well as from the cap', async () => {
      const big = new Uint8Array(1.5 * 1024 * 1024)
      big.set(f.PDF)
      await env.query(`update setting set value = '1'::jsonb where key = 'upload_max_size_mb'`)
      const res = await multipart(author, '/api/v1/media', { bytes: big, name: 'stor.pdf' })
      expect([res.status, await code(res)]).toEqual([413, 'file_too_large'])
      await env.query(`update setting set value = '64'::jsonb where key = 'upload_max_size_mb'`)
      // The cap of this app is 2 MB: above it the body is refused before it is read.
      const huge = new Uint8Array(4 * 1024 * 1024)
      huge.set(f.PDF)
      expect((await multipart(author, '/api/v1/media', { bytes: huge, name: 'enorm.pdf' })).status).toBe(413)
    })

    it('refuses a group a role may not upload (upload_groups_by_role)', async () => {
      await env.query(`update setting set value = '{"author":["image"]}'::jsonb where key = 'upload_groups_by_role'`)
      const res = await multipart(author, '/api/v1/media', { bytes: f.PDF, name: 'dok.pdf' })
      expect([res.status, await code(res)]).toEqual([400, 'unsupported_type'])
      await upload(editor, f.PDF, 'dok.pdf')
      const list = MediaListResponse.parse(await (await author.get('/api/v1/media?per_page=1')).json())
      expect(list.upload.extensions).toContain('png')
      expect(list.upload.extensions).not.toContain('pdf')
      await env.query(`update setting set value = '{}'::jsonb where key = 'upload_groups_by_role'`)
    })

    it('keeps the stored file under the uploads folder only, with a key the server made', async () => {
      const item = await upload(author, f.PNG, '../../../etc/passwd.png')
      expect(item.originalUrl).toMatch(/^\/uploads\/\d{4}\/\d{2}\/passwd-[0-9a-f]{8}\.png$/)
      const year = item.originalUrl.split('/')[2] ?? ''
      expect((await readdir(join(env.uploadsDir, year))).length).toBeGreaterThan(0)
      for (const path of ['/uploads/../package.json', '/uploads/%2e%2e/x', '/uploads/2026/10/NONE.png']) {
        expect((await env.client().get(path)).status, path).toBe(404)
      }
    })
  })

  describe('rights and private files', () => {
    it('lets the uploader and an editor change a file, not another author', async () => {
      const item = await upload(author, f.PNG, 'eget.png')
      expect((await other.patch(`/api/v1/media/${item.id}`, { alt: 'Nei' })).status).toBe(403)
      expect((await other.delete(`/api/v1/media/${item.id}`)).status).toBe(403)
      const mine = MediaItem.parse(
        await (await author.patch(`/api/v1/media/${item.id}`, { alt: 'Fjord', caption: 'Ved sjøen' })).json(),
      )
      expect(mine).toMatchObject({ alt: 'Fjord', caption: 'Ved sjøen' })
      expect((await editor.patch(`/api/v1/media/${item.id}`, { title: 'Redigert' })).status).toBe(200)
    })

    it('serves a private file only through the api, to its uploader and to read_private_posts', async () => {
      const item = await upload(author, f.PDF, 'hemmelig.pdf')
      const original = item.originalUrl
      const hidden = MediaItem.parse(
        await (await author.patch(`/api/v1/media/${item.id}`, { visibility: 'private' })).json(),
      )
      expect(hidden.originalUrl).toBe(`/api/v1/media/${item.id}/file?size=original`)
      // Not under /uploads any more, signed in or not.
      expect((await env.client().get(original)).status).toBe(404)
      expect((await author.get(original)).status).toBe(404)
      // Not for another author: not in the list, not by id, not the file.
      expect((await other.get(`/api/v1/media/${item.id}`)).status).toBe(404)
      expect((await other.get(`/api/v1/media/${item.id}/file`)).status).toBe(404)
      const list = MediaListResponse.parse(await (await other.get('/api/v1/media?per_page=100')).json())
      expect(list.items.map((entry) => entry.id)).not.toContain(item.id)
      // Its uploader and an editor get it, never cached.
      const file = await author.get(`/api/v1/media/${item.id}/file?size=original`)
      expect(file.status).toBe(200)
      expect(file.headers.get('cache-control')).toBe('private, no-store')
      expect(file.headers.get('content-disposition')).toMatch(/^attachment/)
      expect((await editor.get(`/api/v1/media/${item.id}/file`)).status).toBe(200)
      // Signed out: 401.
      expect((await env.client().get(`/api/v1/media/${item.id}/file`)).status).toBe(401)
    })
  })

  describe('replace, edit and regenerate', () => {
    it('replaces the file under the same id, with a new key, and removes the old one', async () => {
      const item = await upload(author, f.PNG, 'forste.png')
      const res = await multipart(author, `/api/v1/media/${item.id}/replace`, { bytes: f.JPEG, name: 'andre.jpg' })
      expect(res.status).toBe(200)
      const replaced = MediaItem.parse(await res.json())
      expect(replaced).toMatchObject({ id: item.id, mime: 'image/jpeg', fileName: 'andre.jpg', processing: 'pending' })
      expect(replaced.originalUrl).not.toBe(item.originalUrl)
      expect((await env.client().get(item.originalUrl)).status).toBe(404)
      expect((await env.client().get(replaced.originalUrl)).status).toBe(200)
      expect(env.mediaJobs.jobs.at(-1)).toEqual({ kind: 'process', mediaId: item.id })
    })

    it('queues an edit with its steps, and refuses a crop outside the image or an enlargement', async () => {
      const item = await upload(author, f.PNG, 'rediger.png')
      await env.query(`update media set processing = 'ready' where id = $1`, [item.id])
      const outside = await author.post(`/api/v1/media/${item.id}/edit`, {
        operations: [{ op: 'crop', x: 0, y: 0, width: 5, height: 5 }],
      })
      expect([outside.status, await code(outside)]).toEqual([400, 'invalid_edit'])
      const steps = [
        { op: 'rotate', degrees: 90 },
        { op: 'flip', direction: 'horizontal' },
      ]
      const res = await author.post(`/api/v1/media/${item.id}/edit`, { operations: steps })
      expect(res.status).toBe(202)
      expect(MediaItem.parse(await res.json()).processing).toBe('pending')
      expect(env.mediaJobs.jobs.at(-1)).toEqual({ kind: 'edit', mediaId: item.id, operations: steps })
      const busy = await author.post(`/api/v1/media/${item.id}/edit`, { operations: steps })
      expect([busy.status, await code(busy)]).toEqual([409, 'media_busy'])
      const pdf = await upload(author, f.PDF, 'ikke-bilde.pdf')
      expect(await code(await author.post(`/api/v1/media/${pdf.id}/edit`, { operations: steps }))).toBe('not_editable')
    })

    it('queues the sizes of the images again for an administrator', async () => {
      await env.createAccount({ username: 'm-admin', role: 'administrator' })
      const admin = env.client({ ip: '203.0.113.23' })
      expect((await admin.login('m-admin', TEST_PASSWORD)).status).toBe(200)
      const image = await upload(author, f.GIF, 'igjen.gif')
      const before = env.mediaJobs.jobs.length
      const res = await admin.post('/api/v1/media/regenerate', { ids: [image.id] })
      expect(await res.json()).toEqual({ queued: 1 })
      expect(env.mediaJobs.jobs.slice(before)).toEqual([{ kind: 'regenerate', mediaId: image.id }])
      expect((await editor.post('/api/v1/media/regenerate', {})).status).toBe(403)
    })
  })

  describe('«Brukes på», the image block and its migration', () => {
    it('shows which posts use a file, and upgrades a stored image block with its address to the media id', async () => {
      const image = await upload(author, f.PNG, 'brukt.png')
      await author.patch(`/api/v1/media/${image.id}`, { alt: 'Fjord' })
      const res = await author.post('/api/v1/content', {
        type: 'post',
        title: 'Med bilde',
        blocks: [
          {
            id: 'b_img00001',
            type: 'core/image',
            version: 2,
            attrs: { mediaId: image.id, alt: 'Fjord', caption: '', decorative: false },
            children: [],
          },
        ],
      })
      const post = ContentItem.parse(await res.json())
      expect(post.media.map((ref) => ref.id)).toEqual([image.id])
      const detail = MediaDetail.parse(await (await author.get(`/api/v1/media/${image.id}`)).json())
      expect(detail.usedBy).toEqual([{ id: post.id, type: 'post', title: 'Med bilde', status: 'draft' }])

      // A post stored before M1.2, with the prototype's version 1 block pointing at the file's address.
      const [legacy] = await env.query<{ id: string }>(
        `insert into content (type, locale, slug, title, status, comment_status, blocks)
         values ('post', 'nb', 'gammel', 'Gammel', 'draft', 'open', $1::jsonb) returning id`,
        [
          JSON.stringify([
            {
              id: 'b_old00001',
              type: 'core/image',
              version: 1,
              attrs: { url: image.originalUrl, alt: 'Gammel alt', caption: '' },
              children: [],
            },
          ]),
        ],
      )
      await env.query('insert into content_author (content_id, account_id) values ($1, $2)', [legacy?.id, authorId])
      const read = ContentItem.parse(await (await author.get(`/api/v1/content/${legacy?.id ?? ''}`)).json())
      expect(read.blocksFormat).toBe('blocks')
      expect(read.blocks[0]).toMatchObject({
        version: 2,
        attrs: { mediaId: image.id, alt: 'Gammel alt', decorative: false },
      })
      expect(read.media.map((ref) => ref.id)).toEqual([image.id])
    })

    it('refuses an image without alt text unless it is decorative', async () => {
      const image = await upload(author, f.PNG, 'pynt.png')
      const block = (attrs: Record<string, unknown>) => [
        {
          id: 'b_img00002',
          type: 'core/image',
          version: 2,
          attrs: { mediaId: image.id, caption: '', ...attrs },
          children: [],
        },
      ]
      const missing = await author.post('/api/v1/content', {
        type: 'post',
        title: 'Uten alt',
        blocks: block({ alt: '' }),
      })
      expect([missing.status, await code(missing)]).toEqual([400, 'invalid_blocks'])
      const decorative = await author.post('/api/v1/content', {
        type: 'post',
        title: 'Pynt',
        blocks: block({ alt: '', decorative: true }),
      })
      expect(decorative.status).toBe(201)
    })
  })

  describe('folders and settings', () => {
    it('makes, renames, moves and deletes folders; a deleted folder’s files move to the top', async () => {
      const made = MediaFolderListResponse.parse(
        await (await author.post('/api/v1/media-folders', { name: 'Ferie' })).json(),
      )
      const holiday = made.folders.find((folder) => folder.name === 'Ferie')?.id ?? ''
      const nested = MediaFolderListResponse.parse(
        await (await author.post('/api/v1/media-folders', { name: 'Fjell', parentId: holiday })).json(),
      )
      expect(nested.folders.find((folder) => folder.name === 'Fjell')).toMatchObject({ parentId: holiday, depth: 1 })
      expect(await code(await author.post('/api/v1/media-folders', { name: 'ferie' }))).toBe('folder_exists')
      expect(
        await code(
          await author.patch(`/api/v1/media-folders/${holiday}`, {
            parentId: nested.folders.find((x) => x.name === 'Fjell')?.id ?? null,
          }),
        ),
      ).toBe('invalid_folder')
      const file = await upload(author, f.PNG, 'i-mappe.png', { folderId: holiday })
      const inFolder = MediaListResponse.parse(await (await author.get(`/api/v1/media?folder=${holiday}`)).json())
      expect(inFolder.items.map((item) => item.id)).toEqual([file.id])
      expect((await author.delete(`/api/v1/media-folders/${holiday}`)).status).toBe(204)
      const moved = MediaItem.parse((await (await author.get(`/api/v1/media/${file.id}`)).json()) as unknown)
      expect(moved.folderId).toBeNull()
    })

    it('reads and changes Settings → Media for an administrator, never above the cap', async () => {
      const admin = env.client({ ip: '203.0.113.24' })
      expect((await admin.login('m-admin', TEST_PASSWORD)).status).toBe(200)
      const read = (await (await admin.get('/api/v1/settings/media')).json()) as {
        settings: Record<string, unknown>
        uploadMaxSizeCapMb: number
      }
      expect(read.uploadMaxSizeCapMb).toBe(2)
      expect(read.settings).toMatchObject({
        thumbnail_size_w: 150,
        thumbnail_crop: true,
        image_max_pixels: 100_000_000,
      })
      const changed = (await (
        await admin.patch('/api/v1/settings/media', { medium_size_w: 400, upload_max_size_mb: 2 })
      ).json()) as {
        settings: Record<string, unknown>
      }
      expect(changed.settings).toMatchObject({ medium_size_w: 400, upload_max_size_mb: 2 })
      expect(await code(await admin.patch('/api/v1/settings/media', { upload_max_size_mb: 3 }))).toBe(
        'above_upload_cap',
      )
    })
  })

  it('refuses to fetch a private address for «Last opp fra URL» (safeFetch)', async () => {
    for (const url of [
      'http://127.0.0.1/x.png',
      'http://10.0.0.1/x.png',
      'http://[::1]/x.png',
      'http://localhost/x.png',
    ]) {
      const res = await author.post('/api/v1/media/from-url', { url })
      expect([res.status, await code(res)], url).toEqual([400, 'fetch_failed'])
    }
    expect((await author.post('/api/v1/media/from-url', { url: 'file:///etc/passwd' })).status).toBe(400)
  })
})
