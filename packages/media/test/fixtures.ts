// Small real files of the kinds the library takes, built in code so the tests carry no binary blobs. Each has the signature its type
// has on disk; they are not meant to be playable or printable beyond that.
import { crc32, gzipSync } from 'node:zlib'

const b64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))
const ascii = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'))
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts))

/** A 1×1 PNG. */
export const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')
/** A 1×1 GIF. */
export const GIF = b64('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')
/** A 1×1 WebP (lossless). */
export const WEBP = b64('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==')
/** A 1×1 JPEG. */
export const JPEG = b64(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////' +
    '2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQAB' +
    'AQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQ' +
    'A/AKAH/9k=',
)
/** A BMP header for a 2×2 image (the pixels are not needed for detection). */
export const BMP = concat(
  ascii('BM'),
  new Uint8Array([70, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 24, 0]),
  new Uint8Array(40),
)
/** A TIFF header (little endian). */
export const TIFF = concat(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]), new Uint8Array(32))
/** An ICO with one 16×16 entry. */
export const ICO = concat(
  new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 40, 0, 0, 0, 22, 0, 0, 0]),
  new Uint8Array(40),
)
export const PDF = ascii('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
export const RTF = ascii('{\\rtf1\\ansi Hei}')
export const GZ = new Uint8Array(gzipSync(Buffer.from('hei')))
export const MP3 = concat(
  ascii('ID3'),
  new Uint8Array([3, 0, 0, 0, 0, 0, 0]),
  new Uint8Array([0xff, 0xfb, 0x90, 0x64]),
  new Uint8Array(400),
)
export const WAV = concat(
  ascii('RIFF'),
  new Uint8Array([36, 0, 0, 0]),
  ascii('WAVEfmt '),
  new Uint8Array(24),
  ascii('data'),
  new Uint8Array(4),
)
export const OGG = concat(
  ascii('OggS'),
  new Uint8Array([0, 2]),
  new Uint8Array(20),
  new Uint8Array([1, 0x1e]),
  ascii('\u0001vorbis'),
  new Uint8Array(30),
)
export const FLAC = concat(ascii('fLaC'), new Uint8Array(38))
/** An MP4 (ISO base media) `ftyp` box. */
export const MP4 = concat(
  new Uint8Array([0, 0, 0, 0x18]),
  ascii('ftypisom'),
  new Uint8Array([0, 0, 2, 0]),
  ascii('isomiso2'),
  new Uint8Array(16),
)
export const TEXT = ascii('Navn,Alder\nKari,42\n')

interface ZipEntry {
  readonly name: string
  readonly data: string
}

/** A ZIP with the entries stored (no compression): enough for the OOXML and ODF checks, which read the directory. */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data)
    const crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += header.length + name.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, ...central, end]))
}

const contentTypes = (main: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/x" ContentType="${main}"/></Types>`

export const DOCX = zip([
  {
    name: '[Content_Types].xml',
    data: contentTypes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'),
  },
  { name: 'word/document.xml', data: '<w:document/>' },
])
export const XLSX = zip([
  {
    name: '[Content_Types].xml',
    data: contentTypes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'),
  },
  { name: 'xl/workbook.xml', data: '<workbook/>' },
])
export const ODT = zip([
  { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
  { name: 'content.xml', data: '<office:document-content/>' },
])
export const ZIP = zip([{ name: 'hei.txt', data: 'hei' }])
export const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
