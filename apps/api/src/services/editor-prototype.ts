// The editor prototype's image uploads (M0.6, PROTOTYPE): kept in a temporary folder of the api until the media library of M1.2
// replaces them. The prototype's per-account draft is gone since M1.1: the editor saves through the content API.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PROTOTYPE_UPLOAD_NAME } from '@toascribe/shared'

import { BadRequestError, NotFoundError } from '../lib/errors.ts'

/** The image types an upload may be, found from its first bytes (never from its name or the type the browser sent). No SVG: it can hold script. */
const IMAGE_SIGNATURES = [
  {
    extension: 'png',
    type: 'image/png',
    matches: (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { extension: 'jpg', type: 'image/jpeg', matches: (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    extension: 'gif',
    type: 'image/gif',
    matches: (b: Uint8Array) =>
      startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    extension: 'webp',
    type: 'image/webp',
    matches: (b: Uint8Array) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
] as const

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

/** The kind of image the bytes are, or undefined. */
export function sniffImage(bytes: Uint8Array): { extension: string; type: string } | undefined {
  const found = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes))
  return found === undefined ? undefined : { extension: found.extension, type: found.type }
}

const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(
  IMAGE_SIGNATURES.map((signature) => [signature.extension, signature.type]),
)

/**
 * The most images the temporary folder keeps; the oldest goes when a new one comes. The api's /tmp is a tmpfs that counts against
 * its memory limit, so the folder must not grow without end. A limit of safety, not a setting.
 */
export const PROTOTYPE_MAX_UPLOADS = 50

export const PROTOTYPE_UPLOAD_PATH = '/api/v1/prototype/editor/uploads/'

export interface EditorPrototypeService {
  saveUpload(file: File): Promise<{ url: string }>
  readUpload(name: string): Promise<{ bytes: Uint8Array; type: string }>
}

export function createEditorPrototypeService(options: {
  /** The temporary folder for uploads (default: `<os tmpdir>/toascribe-editor-prototype`). */
  readonly uploadDir: string
}): EditorPrototypeService {
  const { uploadDir } = options

  async function pruneUploads(): Promise<void> {
    const names = (await readdir(uploadDir)).filter((name) => PROTOTYPE_UPLOAD_NAME.test(name))
    if (names.length < PROTOTYPE_MAX_UPLOADS) {
      return
    }
    const dated = await Promise.all(
      names.map(async (name) => ({ name, at: (await stat(join(uploadDir, name))).mtimeMs })),
    )
    dated.sort((a, b) => a.at - b.at)
    for (const { name } of dated.slice(0, names.length - PROTOTYPE_MAX_UPLOADS + 1)) {
      await unlink(join(uploadDir, name)).catch(() => undefined)
    }
  }

  return {
    async saveUpload(file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = sniffImage(bytes)
      if (bytes.length === 0 || kind === undefined) {
        throw new BadRequestError('Upload a PNG, JPEG, GIF or WebP image', 'unsupported_image')
      }
      await mkdir(uploadDir, { recursive: true, mode: 0o700 })
      await pruneUploads()
      const name = `${randomUUID()}.${kind.extension}`
      await writeFile(join(uploadDir, name), bytes, { mode: 0o600, flag: 'wx' })
      return { url: `${PROTOTYPE_UPLOAD_PATH}${name}` }
    },

    async readUpload(name) {
      // The name is checked against the exact pattern before it touches the file system: no path, no other extension.
      const type = PROTOTYPE_UPLOAD_NAME.test(name)
        ? TYPE_BY_EXTENSION[name.slice(name.lastIndexOf('.') + 1)]
        : undefined
      if (type === undefined) {
        throw new NotFoundError()
      }
      try {
        return { bytes: new Uint8Array(await readFile(join(uploadDir, name))), type }
      } catch {
        throw new NotFoundError()
      }
    },
  }
}
