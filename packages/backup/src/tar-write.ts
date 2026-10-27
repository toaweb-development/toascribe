// Writes a tar archive (POSIX ustar, with a pax header for a long name) of regular files only, each read from a path the caller
// chose and stored under a name the caller chose. Nothing is followed or guessed: no links, no directories, no owner or mode from
// the disk (every file is 0600, owner 0). That keeps the archive to exactly what the manifest lists.
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

export interface TarFile {
  /** The name in the archive (checked by the caller: isArchivePath). */
  readonly name: string
  /** Where its bytes are read from: a file, or the bytes themselves (the keys, which never touch the disk in plain text). */
  readonly source: string | Buffer
  readonly size: number
}

const BLOCK = 512

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function header(name: string, size: number, type: '0' | 'x', mtime: number): Buffer {
  const block = Buffer.alloc(BLOCK)
  block.write(name.slice(0, 100), 0, 'utf8')
  block.write(octal(0o600, 8), 100, 'ascii')
  block.write(octal(0, 8), 108, 'ascii')
  block.write(octal(0, 8), 116, 'ascii')
  block.write(octal(size, 12), 124, 'ascii')
  block.write(octal(mtime, 12), 136, 'ascii')
  block.write('        ', 148, 'ascii')
  block.write(type, 156, 'ascii')
  block.write('ustar\0', 257, 'ascii')
  block.write('00', 263, 'ascii')
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return block
}

/** A pax record `<length> path=<name>\n`, whose length counts itself. */
function paxPath(name: string): Buffer {
  const body = ` path=${name}\n`
  let length = Buffer.byteLength(body) + 1
  while (String(length).length + Buffer.byteLength(body) !== length) length += 1
  return Buffer.from(`${String(length)}${body}`, 'utf8')
}

function padding(size: number): Buffer {
  const rest = size % BLOCK
  return Buffer.alloc(rest === 0 ? 0 : BLOCK - rest)
}

async function* blocks(files: readonly TarFile[], mtime: number): AsyncGenerator<Buffer> {
  for (const file of files) {
    if (Buffer.byteLength(file.name) > 100) {
      const record = paxPath(file.name)
      yield header('PaxHeader', record.length, 'x', mtime)
      yield record
      yield padding(record.length)
    }
    yield header(file.name, file.size, '0', mtime)
    let written = 0
    const chunks = typeof file.source === 'string' ? createReadStream(file.source) : [file.source]
    for await (const chunk of chunks) {
      const buffer = chunk as Buffer
      written += buffer.length
      if (written > file.size) throw new Error(`${file.name} grew while it was archived`)
      yield buffer
    }
    if (written !== file.size) throw new Error(`${file.name} changed size while it was archived`)
    yield padding(file.size)
  }
  yield Buffer.alloc(BLOCK * 2)
}

/** The archive as a stream. */
export function tarStream(files: readonly TarFile[], at: Date): Readable {
  return Readable.from(blocks(files, Math.floor(at.getTime() / 1000)))
}
