// The storage of the media files (PLAN «Besluttet»: a local volume behind an interface; S3 later, docs/BACKLOG.md). The api writes
// originals, the worker writes the sizes, and the api reads both to serve them. A key is checked against STORAGE_KEY before it is turned
// into a path, and the path must stay under the root, so no key can reach a file outside the volume.
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

import { STORAGE_KEY } from './names.ts'

export interface StoredFile {
  readonly size: number
}

export interface MediaStorage {
  /** Writes a file; replaces one with the same key. */
  put(key: string, bytes: Uint8Array): Promise<void>
  read(key: string): Promise<Uint8Array>
  /** A stream of the file, for serving it. */
  stream(key: string): Readable
  /** The file's size, or undefined when there is none. */
  stat(key: string): Promise<StoredFile | undefined>
  /** Deletes a file; nothing when it is not there. */
  remove(key: string): Promise<void>
}

export class InvalidStorageKeyError extends Error {
  override readonly name = 'InvalidStorageKeyError'
  constructor() {
    super('invalid storage key')
  }
}

/** The local-volume driver. `root` is the uploads folder (UPLOADS_DIR); files are written owner-readable only (0640). */
export function createLocalStorage(root: string): MediaStorage {
  const base = resolve(root)

  function pathOf(key: string): string {
    if (!STORAGE_KEY.test(key)) {
      throw new InvalidStorageKeyError()
    }
    const path = resolve(join(base, key))
    if (!path.startsWith(base + sep)) {
      throw new InvalidStorageKeyError()
    }
    return path
  }

  return {
    async put(key, bytes) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true, mode: 0o750 })
      // Write beside it and rename: a reader never sees half a file.
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(temporary, bytes, { mode: 0o640, flag: 'wx' })
      await rename(temporary, path)
    },
    async read(key) {
      return new Uint8Array(await readFile(pathOf(key)))
    },
    stream(key) {
      return createReadStream(pathOf(key))
    },
    async stat(key) {
      try {
        const info = await stat(pathOf(key))
        return info.isFile() ? { size: info.size } : undefined
      } catch (err) {
        if (err instanceof InvalidStorageKeyError) throw err
        return undefined
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true })
    },
  }
}
