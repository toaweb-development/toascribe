/** More than any password: NewPassword stops at 4096 characters, and a few bytes per character is still far below this. */
const STDIN_LIMIT_BYTES = 64 * 1024

/** Thrown when standard input holds more than a password can. The message names no content. */
export class StdinTooLongError extends Error {
  constructor() {
    super('standard input is too long for a password')
    this.name = 'StdinTooLongError'
  }
}

/** Reads the process' standard input to its end as UTF-8, refusing more than STDIN_LIMIT_BYTES. */
export async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    size += buffer.length
    if (size > STDIN_LIMIT_BYTES) {
      throw new StdinTooLongError()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
