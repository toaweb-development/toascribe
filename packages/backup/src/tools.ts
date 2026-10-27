// The programs a backup runs (the api image has them: postgresql18-client, zstd, age): pg_dump, pg_restore and psql with the
// connection in the environment (PGHOST and friends, never on a command line another process could read), zstd to compress, age to
// encrypt. An error names the program and its exit code, and at most the last lines of what it wrote to stderr (which never holds
// the password: it is not on the command line).
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/** Where the programs are (Alpine and Debian alike); fixed, so nothing of the caller's environment decides which program runs. */
const TOOL_PATH = '/usr/local/bin:/usr/bin:/bin'

/** The environment that connects pg_dump, pg_restore and psql to the database in `url`. */
export function pgEnvironment(url: string): NodeJS.ProcessEnv {
  const parsed = new URL(url)
  return {
    PATH: TOOL_PATH,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port === '' ? '5432' : parsed.port,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGSSLMODE: parsed.searchParams.get('sslmode') ?? 'prefer',
    PGAPPNAME: 'toascribe-backup',
  }
}

export class ToolError extends Error {
  constructor(program: string, code: number | null, stderr: string) {
    const tail = stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 500)
    super(`${program} failed (exit ${String(code)})${tail === '' ? '' : `: ${tail}`}`)
    this.name = 'ToolError'
  }
}

/** Starts a program with its own environment (nothing of ours leaks into it beyond what is given). */
export function start(
  program: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = { PATH: TOOL_PATH },
): {
  child: ChildProcess
  done: Promise<void>
} {
  const child = spawn(program, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-4000)
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      reject(new ToolError(program, null, error.message))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new ToolError(program, code, stderr))
    })
  })
  return { child, done }
}

/** Runs a program to its end, with stdin closed. */
export async function run(program: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<void> {
  const { child, done } = start(program, args, env)
  child.stdin?.end()
  child.stdout?.resume()
  await done
}

/** Runs a program to its end and gives what it wrote to stdout (for a short answer: at most 64 MiB). */
export async function capture(program: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { child, done } = start(program, args, env)
  child.stdin?.end()
  const chunks: Buffer[] = []
  let size = 0
  child.stdout?.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= 64 * 1024 * 1024) chunks.push(chunk)
  })
  await done
  return Buffer.concat(chunks).toString('utf8')
}
