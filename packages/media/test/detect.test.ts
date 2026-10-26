import { describe, expect, it } from 'vitest'

import { MEDIA_TYPES, detectType, extensionOf, headerDimensions, looksLikeText } from '../src/index.ts'
import * as f from './fixtures.ts'

describe('detectType', () => {
  it.each([
    ['bilde.png', f.PNG, 'image/png', 'image'],
    ['bilde.JPG', f.JPEG, 'image/jpeg', 'image'],
    ['bilde.jpeg', f.JPEG, 'image/jpeg', 'image'],
    ['bilde.gif', f.GIF, 'image/gif', 'image'],
    ['bilde.webp', f.WEBP, 'image/webp', 'image'],
    ['bilde.bmp', f.BMP, 'image/bmp', 'image'],
    ['bilde.tif', f.TIFF, 'image/tiff', 'image'],
    ['favicon.ico', f.ICO, 'image/x-icon', 'image'],
    ['dok.pdf', f.PDF, 'application/pdf', 'document'],
    ['dok.rtf', f.RTF, 'application/rtf', 'document'],
    ['dok.docx', f.DOCX, MEDIA_TYPES['docx']?.mime, 'document'],
    ['makro.docm', f.DOCX, MEDIA_TYPES['docm']?.mime, 'document'],
    ['regneark.xlsx', f.XLSX, MEDIA_TYPES['xlsx']?.mime, 'spreadsheet'],
    ['tekst.odt', f.ODT, MEDIA_TYPES['odt']?.mime, 'document'],
    ['arkiv.zip', f.ZIP, 'application/zip', 'archive'],
    ['arkiv.gz', f.GZ, 'application/x-gzip', 'archive'],
    ['lyd.mp3', f.MP3, 'audio/mpeg', 'audio'],
    ['lyd.wav', f.WAV, 'audio/wav', 'audio'],
    ['lyd.ogg', f.OGG, 'audio/ogg', 'audio'],
    ['lyd.flac', f.FLAC, 'audio/flac', 'audio'],
    ['film.mp4', f.MP4, 'video/mp4', 'video'],
    ['data.csv', f.TEXT, 'text/csv', 'text'],
    ['notat.txt', f.TEXT, 'text/plain', 'text'],
  ])('takes %s as %s', async (name, bytes, mime, group) => {
    expect(await detectType(bytes, name)).toEqual({ ok: true, ext: extensionOf(name), mime, group })
  })

  it.each([
    ['an SVG', 'bilde.svg', f.SVG, 'unsupported_type'],
    ['an SVG named .png', 'bilde.png', f.SVG, 'type_mismatch'],
    ['a PNG named .jpg', 'bilde.jpg', f.PNG, 'type_mismatch'],
    ['a PDF named .docx', 'dok.docx', f.PDF, 'type_mismatch'],
    ['a plain ZIP named .docx', 'dok.docx', f.ZIP, 'type_mismatch'],
    ['an SVG named .txt', 'notat.txt', f.SVG, 'type_mismatch'],
    ['a PNG named .txt', 'notat.txt', f.PNG, 'type_mismatch'],
    [
      'HTML named .csv',
      'data.csv',
      new TextEncoder().encode('<html><script>alert(1)</script></html>'),
      'type_mismatch',
    ],
    ['an HTML file', 'side.html', new TextEncoder().encode('<p>hei</p>'), 'unsupported_type'],
    ['a script', 'kode.js', new TextEncoder().encode('alert(1)'), 'unsupported_type'],
    ['a program', 'program.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'unsupported_type'],
    ['no extension', 'bilde', f.PNG, 'unsupported_type'],
    ['an empty file', 'bilde.png', new Uint8Array(), 'empty_file'],
  ])('refuses %s', async (_what, name, bytes, reason) => {
    expect(await detectType(bytes, name)).toEqual({ ok: false, reason })
  })

  it('refuses a group the role may not upload', async () => {
    expect(await detectType(f.PDF, 'dok.pdf', ['image'])).toEqual({ ok: false, reason: 'unsupported_type' })
    expect((await detectType(f.PNG, 'bilde.png', ['image'])).ok).toBe(true)
  })

  it('has no SVG, no HTML, no script and no program on the list', () => {
    for (const ext of ['svg', 'svgz', 'htm', 'html', 'js', 'exe', 'swf', 'class']) {
      expect(MEDIA_TYPES[ext], ext).toBeUndefined()
    }
  })
})

describe('looksLikeText', () => {
  it('takes UTF-8 text and refuses control bytes and broken UTF-8', () => {
    expect(looksLikeText(new TextEncoder().encode('Blåbær\tsyltetøy\r\n'))).toBe(true)
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0xc3, 0x28]))).toBe(false)
  })
})

describe('headerDimensions', () => {
  it('reads the size from the header without decoding', () => {
    expect(headerDimensions(f.PNG)).toEqual({ width: 1, height: 1 })
    expect(headerDimensions(f.JPEG)).toEqual({ width: 1, height: 1 })
    expect(headerDimensions(f.GIF)).toEqual({ width: 1, height: 1 })
    expect(headerDimensions(f.PDF)).toBeUndefined()
  })

  it('believes a header that claims a huge image (the pixel limit then refuses it)', () => {
    const bomb = new Uint8Array(f.PNG)
    // IHDR width and height at bytes 16-23: 60 000 × 60 000.
    new DataView(bomb.buffer).setUint32(16, 60_000)
    new DataView(bomb.buffer).setUint32(20, 60_000)
    expect(headerDimensions(bomb)).toEqual({ width: 60_000, height: 60_000 })
  })
})
