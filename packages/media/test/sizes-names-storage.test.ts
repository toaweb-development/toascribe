import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  InvalidStorageKeyError,
  createLocalStorage,
  defaultSizes,
  derivedKey,
  originalKey,
  planSizes,
  readableName,
  resizeDimensions,
  shownFile,
} from '../src/index.ts'

const SETTINGS = {
  thumbnail_size_w: 150,
  thumbnail_size_h: 150,
  thumbnail_crop: true,
  medium_size_w: 300,
  medium_size_h: 300,
  large_size_w: 1024,
  large_size_h: 1024,
}

describe('the sizes, as WordPress makes them', () => {
  it('makes every size of a big landscape photo, with -scaled above 2560', () => {
    const plan = planSizes(4000, 3000, defaultSizes(SETTINGS))
    expect(plan.sizes.map((size) => [size.name, size.width, size.height])).toEqual([
      ['thumbnail', 150, 150],
      ['medium', 300, 225],
      ['medium_large', 768, 576],
      ['large', 1024, 768],
      ['1536x1536', 1536, 1152],
      ['2048x2048', 2048, 1536],
    ])
    expect(plan.scaled).toMatchObject({ width: 2560, height: 1920 })
  })

  it('never scales up, and keeps a small image as it is', () => {
    const plan = planSizes(500, 400, defaultSizes(SETTINGS))
    expect(plan.sizes.map((size) => size.name)).toEqual(['thumbnail', 'medium'])
    expect(plan.scaled).toBeUndefined()
    expect(planSizes(120, 80, defaultSizes(SETTINGS)).sizes).toEqual([])
  })

  it('crops the thumbnail to at most its box (WordPress: 100×300 gives 100×150)', () => {
    expect(resizeDimensions(100, 300, { name: 'thumbnail', width: 150, height: 150, crop: true })).toEqual({
      name: 'thumbnail',
      width: 100,
      height: 150,
      crop: true,
    })
  })

  it('takes a portrait photo by its height, and skips a size set to 0 × 0', () => {
    expect(resizeDimensions(3000, 4000, { name: 'large', width: 1024, height: 1024, crop: false })).toMatchObject({
      width: 768,
      height: 1024,
    })
    expect(resizeDimensions(3000, 4000, { name: 'medium', width: 0, height: 0, crop: false })).toBeUndefined()
  })
})

describe('storage keys', () => {
  it('makes a readable, safe key in year and month folders', () => {
    const at = new Date('2026-10-26T12:00:00Z')
    expect(originalKey('Blåbær på Ørland.JPG', 'jpg', at, true, 'abcdef01')).toBe(
      '2026/10/blabaer-pa-orland-abcdef01.jpg',
    )
    expect(originalKey('../../etc/passwd', 'txt', at, false, 'abcdef01')).toBe('passwd-abcdef01.txt')
    expect(readableName('§§§.png')).toBe('file')
    expect(derivedKey('2026/10/bilde-abcdef01.jpg', '300x200')).toBe('2026/10/bilde-abcdef01-300x200.webp')
  })
})

describe('the local storage', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'toascribe-media-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes, reads, stats and removes a file under the root, owner-readable only', async () => {
    const storage = createLocalStorage(root)
    await storage.put('2026/10/a.txt', new TextEncoder().encode('hei'))
    expect(new TextDecoder().decode(await storage.read('2026/10/a.txt'))).toBe('hei')
    expect(await storage.stat('2026/10/a.txt')).toEqual({ size: 3 })
    expect((await stat(join(root, '2026/10/a.txt'))).mode & 0o777).toBe(0o640)
    expect(await readFile(join(root, '2026/10/a.txt'), 'utf8')).toBe('hei')
    await storage.remove('2026/10/a.txt')
    expect(await storage.stat('2026/10/a.txt')).toBeUndefined()
  })

  it('refuses a key that could leave the root', async () => {
    const storage = createLocalStorage(root)
    for (const key of ['../x', '/etc/passwd', 'a/../../x', 'A.txt', 'a//b', '', 'a\\b', '.hidden']) {
      await expect(storage.put(key, new Uint8Array([1])), key).rejects.toBeInstanceOf(InvalidStorageKeyError)
    }
  })
})

describe('shownFile', () => {
  const size = (width: number, height: number) => ({ key: `k-${String(width)}`, width, height, mime: 'image/webp' })
  const jpeg = { key: 'a.jpg', width: 4000, height: 3000, mime: 'image/jpeg' }

  it('is the edited image, then the -scaled copy, then a web original', () => {
    const edited = size(600, 900)
    const scaled = size(2560, 1920)
    expect(shownFile(jpeg, { sizes: {}, scaled, edited })).toBe(edited)
    expect(shownFile(jpeg, { sizes: { medium: size(300, 225) }, scaled })).toBe(scaled)
    expect(shownFile(jpeg, { sizes: { medium: size(300, 225) } })).toBe(jpeg)
  })

  it('is the largest size for an image a browser does not show, and the original for a file that is not an image', () => {
    const tiff = { key: 'a.tif', width: 3000, height: 2000, mime: 'image/tiff' }
    expect(shownFile(tiff, { sizes: { medium: size(300, 200), large: size(1024, 683) } }).key).toBe('k-1024')
    expect(shownFile(tiff, { sizes: {} })).toBe(tiff)
    const pdf = { key: 'a.pdf', width: null, height: null, mime: 'application/pdf' }
    expect(shownFile(pdf, { sizes: {} })).toBe(pdf)
  })
})
