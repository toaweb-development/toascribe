// The media jobs against a real PostgreSQL and real images (made by sharp in the test): the sizes in the right dimensions as WebP,
// `-scaled` above 2560, nothing scaled up, EXIF orientation, the edit steps (the original kept), regeneration after the sizes change,
// the pixel limit when decoding, and the sweep of lost jobs. Needs TEST_DATABASE_URL.
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MediaVariantsData } from '@toascribe/shared'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GAVE_UP, failureOf, runMediaJob, sweepPending } from '../src/jobs/media.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb } from './harness.ts'
import type { JobDb } from './harness.ts'

noticeIfSkipped('worker media jobs')

const NOW = new Date('2026-10-26T12:00:00.000Z')

describe.skipIf(TEST_DATABASE_URL === undefined)('media jobs (needs TEST_DATABASE_URL)', () => {
  let env: JobDb
  let uploads: string
  let serial = 0

  beforeAll(async () => {
    env = await startJobDb()
    uploads = await mkdtemp(join(tmpdir(), 'toascribe-media-jobs-'))
  })
  afterAll(async () => {
    await env.close()
    await rm(uploads, { recursive: true, force: true })
  })
  beforeEach(async () => {
    await env.query(`update setting set value = '300'::jsonb where key = 'medium_size_w'`)
    await env.query(`update setting set value = '100000000'::jsonb where key = 'image_max_pixels'`)
  })

  const deps = () => ({ db: env.db, logger: memoryLogger().logger, uploadsDir: uploads, now: () => NOW })

  /** Stores an image as an upload would, and returns the media id and the key of the original. */
  async function stored(bytes: Buffer, mime: string, ext: string): Promise<{ id: string; key: string }> {
    serial += 1
    const key = `2026/10/bilde-${String(serial).padStart(8, '0')}.${ext}`
    const path = join(uploads, key)
    await (await import('node:fs/promises')).mkdir(join(uploads, '2026/10'), { recursive: true })
    await (await import('node:fs/promises')).writeFile(path, bytes)
    const [row] = await env.query<{ id: string }>(
      `insert into media (mime, size, sha256, storage_key, file_name, processing)
       values ($1, $2, $3, $4, $5, 'pending') returning id`,
      [mime, bytes.length, createHash('sha256').update(bytes).digest('hex'), key, `bilde.${ext}`],
    )
    return { id: row?.id ?? '', key }
  }

  const photo = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer()

  async function variantsOf(id: string) {
    const [row] = await env.query<{ variants: unknown; processing: string; width: number; height: number }>(
      'select variants, processing, width, height from media where id = $1',
      [id],
    )
    return { ...row, variants: MediaVariantsData.parse(row?.variants) }
  }

  it('makes every size of a big photo as WebP, and a -scaled copy above 2560', async () => {
    const { id, key } = await stored(await photo(4000, 3000), 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const row = await variantsOf(id)
    expect(row.processing).toBe('ready')
    expect([row.width, row.height]).toEqual([4000, 3000])
    const sizes = Object.fromEntries(
      Object.entries(row.variants.sizes).map(([name, size]) => [name, [size.width, size.height]]),
    )
    expect(sizes).toEqual({
      thumbnail: [150, 150],
      medium: [300, 225],
      medium_large: [768, 576],
      large: [1024, 768],
      '1536x1536': [1536, 1152],
      '2048x2048': [2048, 1536],
    })
    expect(row.variants.scaled).toMatchObject({ width: 2560, height: 1920, mime: 'image/webp' })
    expect(row.variants.scaled?.key).toMatch(new RegExp(`^${key.replace(/\.jpg$/, '')}-[0-9a-f]{8}-scaled\\.webp$`))
    expect(row.variants.sizes['medium']?.key).toMatch(/-[0-9a-f]{8}-300x225\.webp$/)
    for (const size of Object.values(row.variants.sizes)) {
      const meta = await sharp(await readFile(join(uploads, size.key))).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', size.width, size.height])
    }
  })

  it('never scales up: a small image gets only the sizes that are smaller, and no -scaled', async () => {
    const { id } = await stored(
      await sharp({ create: { width: 200, height: 120, channels: 4, background: '#fff0' } })
        .png()
        .toBuffer(),
      'image/png',
      'png',
    )
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const row = await variantsOf(id)
    expect(Object.keys(row.variants.sizes)).toEqual(['thumbnail'])
    expect(row.variants.sizes['thumbnail']).toMatchObject({ width: 150, height: 120 })
    expect(row.variants.scaled).toBeUndefined()
  })

  it('applies the EXIF orientation', async () => {
    // 600 × 400 pixels stored with orientation 6 (rotate 90°): shown as 400 × 600.
    const rotated = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#888' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const { id } = await stored(rotated, 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const row = await variantsOf(id)
    expect([row.width, row.height]).toEqual([400, 600])
    expect(row.variants.sizes['medium']).toMatchObject({ width: 200, height: 300 })
  })

  it('edits from the steps, keeps the original, and cuts the sizes from the edited image', async () => {
    const original = await photo(1200, 800)
    const { id, key } = await stored(original, 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    await runMediaJob(deps(), {
      kind: 'edit',
      mediaId: id,
      operations: [
        { op: 'rotate', degrees: 90 },
        { op: 'crop', x: 0, y: 0, width: 600, height: 900 },
        { op: 'flip', direction: 'horizontal' },
      ],
    })
    const row = await variantsOf(id)
    expect(row.variants.edited).toMatchObject({ width: 600, height: 900, mime: 'image/webp' })
    expect(row.variants.edited?.key).toMatch(/-e\d{13}\.webp$/)
    expect(row.variants.sizes['medium']).toMatchObject({ width: 200, height: 300 })
    expect(row.variants.scaled).toBeUndefined()
    // The original file is as it was uploaded.
    expect(
      createHash('sha256')
        .update(await readFile(join(uploads, key)))
        .digest('hex'),
    ).toBe(createHash('sha256').update(original).digest('hex'))
  })

  it('edits a big photo in the pixels of its -scaled copy, the image the person saw', async () => {
    const { id } = await stored(await photo(4000, 3000), 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    // The api checked this crop against the 2560 × 1920 copy; in the original it would be a different part of the picture.
    await runMediaJob(deps(), {
      kind: 'edit',
      mediaId: id,
      operations: [{ op: 'crop', x: 1280, y: 960, width: 1280, height: 960 }],
    })
    const row = await variantsOf(id)
    expect(row.variants.edited).toMatchObject({ width: 1280, height: 960 })
  })

  it('gives every generated file a new address at each edit and regeneration, and removes the old files', async () => {
    const { id } = await stored(await photo(3000, 2000), 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const keysOf = (variants: MediaVariantsData) => [
      ...Object.values(variants.sizes).map((size) => size.key),
      ...(variants.scaled === undefined ? [] : [variants.scaled.key]),
      ...(variants.edited === undefined ? [] : [variants.edited.key]),
    ]
    const first = keysOf((await variantsOf(id)).variants)
    // The site drops what it cached with the old addresses (M1.4).
    expect(await env.query(`select 1 from cache_invalidation where tag = $1`, [`media:${id}`])).not.toHaveLength(0)
    // Same settings, same pixels: still new addresses, so nothing cached `immutable` is ever served for other pixels.
    await runMediaJob(deps(), { kind: 'regenerate', mediaId: id })
    const second = keysOf((await variantsOf(id)).variants)
    await runMediaJob(deps(), {
      kind: 'edit',
      mediaId: id,
      operations: [{ op: 'crop', x: 0, y: 0, width: 800, height: 800 }],
    })
    const third = keysOf((await variantsOf(id)).variants)
    for (const [before, after] of [
      [first, second],
      [second, third],
    ] as const) {
      expect(after.filter((key) => before.includes(key))).toEqual([])
      for (const key of before) await expect(stat(join(uploads, key))).rejects.toThrow()
    }
    for (const key of third) expect((await stat(join(uploads, key))).size).toBeGreaterThan(0)
  })

  it('makes the sizes again after the settings change, and removes the files that are no longer a size', async () => {
    const { id } = await stored(await photo(1600, 1200), 'image/jpeg', 'jpg')
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const before = await variantsOf(id)
    const oldMedium = before.variants.sizes['medium']?.key ?? ''
    await env.query(`update setting set value = '400'::jsonb where key = 'medium_size_w'`)
    await env.query(`update setting set value = '400'::jsonb where key = 'medium_size_h'`)
    await runMediaJob(deps(), { kind: 'regenerate', mediaId: id })
    const after = await variantsOf(id)
    expect(after.variants.sizes['medium']).toMatchObject({ width: 400, height: 300 })
    await expect(stat(join(uploads, oldMedium))).rejects.toThrow()
    await env.query(`update setting set value = '300'::jsonb where key = 'medium_size_h'`)
  })

  async function stateOf(id: string) {
    const [row] = await env.query<{ processing: string; processing_error: string | null; processing_attempts: number }>(
      'select processing, processing_error, processing_attempts from media where id = $1',
      [id],
    )
    return row
  }

  it('refuses to decode an image above the pixel limit: tried three times, then failed with the reason', async () => {
    await env.query(`update setting set value = '1000000'::jsonb where key = 'image_max_pixels'`)
    const { id } = await stored(await photo(1500, 1000), 'image/jpeg', 'jpg')
    // Two runs with tries left: still pending, and the job throws so pg-boss runs it again.
    for (const attempt of [1, 2]) {
      await expect(runMediaJob(deps(), { kind: 'process', mediaId: id })).rejects.toThrow()
      expect(await stateOf(id)).toMatchObject({ processing: 'pending', processing_attempts: attempt })
    }
    // The third: failed, with the reason, and no throw (no fourth try).
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const row = await stateOf(id)
    expect(row).toMatchObject({ processing: 'failed', processing_attempts: 3 })
    expect(row?.processing_error).toBe('too_many_pixels')
    // A job that still comes (an old one, a retry) does not run it again.
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    expect(await stateOf(id)).toMatchObject({ processing: 'failed', processing_attempts: 4 })
  })

  it('stores a code for a failure, never the message (which can name a path on the server)', async () => {
    const { id, key } = await stored(await photo(100, 100), 'image/jpeg', 'jpg')
    await rm(join(uploads, key))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runMediaJob(deps(), { kind: 'process', mediaId: id }).catch(() => undefined)
    }
    expect(await stateOf(id)).toMatchObject({ processing: 'failed', processing_error: 'missing_file' })
    expect(failureOf(new Error('Input file contains unsupported image format'))).toBe('unreadable_image')
    expect(failureOf(new Error('something else at /var/lib/toascribe/uploads/x.jpg'))).toBe('unknown')
  })

  it('counts a run that never finished (the worker died), and gives up after three', async () => {
    const { id } = await stored(await photo(100, 100), 'image/jpeg', 'jpg')
    // Three runs started and none came back: the count is in its own commit, so it is there.
    await env.query('update media set processing_attempts = 3 where id = $1', [id])
    await runMediaJob(deps(), { kind: 'process', mediaId: id })
    const row = await stateOf(id)
    expect(row?.processing).toBe('failed')
    expect(row?.processing_error).toBe(GAVE_UP)
    // «Lag bildestørrelser på nytt» sets the count back (the api does), and it works again.
    await env.query(
      `update media set processing = 'pending', processing_error = null, processing_attempts = 0 where id = $1`,
      [id],
    )
    await runMediaJob(deps(), { kind: 'regenerate', mediaId: id })
    expect(await stateOf(id)).toMatchObject({ processing: 'ready', processing_error: null, processing_attempts: 1 })
  })

  it('marks an image whose tries ran out failed instead of queueing it again', async () => {
    const { id } = await stored(await photo(100, 100), 'image/jpeg', 'jpg')
    await env.query(`update media set modified_at = $2, processing_attempts = 3 where id = $1`, [
      id,
      new Date(NOW.getTime() - 15 * 60_000),
    ])
    const sent: unknown[] = []
    const boss = {
      send: (_name: string, data: object | null) => {
        sent.push(data)
        return Promise.resolve('job')
      },
    }
    await sweepPending({ db: env.db, logger: memoryLogger().logger, now: () => NOW }, boss as never)
    expect(sent).not.toContainEqual({ kind: 'process', mediaId: id })
    expect(await stateOf(id)).toMatchObject({ processing: 'failed', processing_error: GAVE_UP })
  })

  it('queues the images that stayed pending, once each', async () => {
    const { id } = await stored(await photo(100, 100), 'image/jpeg', 'jpg')
    await env.query(`update media set modified_at = $2 where id = $1`, [id, new Date(NOW.getTime() - 15 * 60_000)])
    const sent: { name: string; data: unknown; key: string | undefined }[] = []
    const boss = {
      send: (name: string, data: object | null, options?: { singletonKey?: string }) => {
        sent.push({ name, data, key: options?.singletonKey })
        return Promise.resolve('job')
      },
    }
    const queued = await sweepPending({ db: env.db, logger: memoryLogger().logger, now: () => NOW }, boss as never)
    expect(queued).toBeGreaterThanOrEqual(1)
    expect(sent).toContainEqual({ name: 'media.process', data: { kind: 'process', mediaId: id }, key: `process:${id}` })
  })
})
