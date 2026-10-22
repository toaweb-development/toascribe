import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Talks to the stack that `e2e/stack.sh up` started: runs commands in its containers, and reads its mail box (Mailpit).
// The names come from the environment (`e2e/stack.sh env`), so a stack started by hand under another project name works too.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

// The defaults are stack.sh's own, so `e2e/stack.sh up` followed by `pnpm test:e2e` needs no exports. A stack started with
// other names or ports is described by the variables (`e2e/stack.sh env` prints them).
const PROJECT = process.env.E2E_PROJECT ?? 'toascribe-e2e'
const DEFAULTS: Readonly<Record<string, string>> = {
  E2E_BASE_URL: 'http://localhost:18080',
  E2E_MAILPIT_URL: 'http://localhost:18025',
  E2E_PROJECT: PROJECT,
  E2E_ENV_FILE: `${process.env.E2E_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/${PROJECT}`}/env`,
}

function env(name: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? (DEFAULTS[name] ?? '') : value
}

export const baseUrl = (): string => env('E2E_BASE_URL')
const mailpitUrl = (): string => env('E2E_MAILPIT_URL')

/** `docker compose` for the e2e project; resolves with stdout. `input` goes to standard input (passwords never go in arguments). */
export function compose(args: readonly string[], input?: string): Promise<string> {
  const full = [
    'compose',
    '-p',
    env('E2E_PROJECT'),
    '-f',
    `${REPO_ROOT}docker/compose.yaml`,
    '--env-file',
    env('E2E_ENV_FILE'),
    '--profile',
    'mailpit',
    ...args,
  ]
  return new Promise((resolve, reject) => {
    const child = execFile('docker', full, { maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`docker compose ${args.join(' ')} failed: ${stderr || error.message}`))
      } else {
        resolve(stdout)
      }
    })
    child.stdin?.end(input ?? '')
  })
}

let counter = 0

/** A name that no other test uses, in this run and the last: 3 to 60 characters, letters and digits. */
export function uniqueName(prefix: string): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter}`
}

export const PASSWORD = 'correct horse battery 42'

export interface TestUser {
  username: string
  email: string
  password: string
}

/** Makes an account with `toa user create` (through the api container), with a known password. */
export async function createUser(role: string, prefix = 'user', password = PASSWORD): Promise<TestUser> {
  const username = uniqueName(prefix)
  const user = { username, email: `${username}@example.test`, password }
  await compose(
    [
      'exec',
      '-T',
      'api',
      'toa',
      'user',
      'create',
      '--username',
      user.username,
      '--email',
      user.email,
      '--role',
      role,
      '--password-stdin',
    ],
    password,
  )
  return user
}

/** Writes a site setting straight into the database (there is no settings screen yet). The key and value are ours, not input. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value).replaceAll("'", "''")
  const sql = `insert into setting (key, value) values ('${key}', '${json}'::jsonb) on conflict (key) do update set value = excluded.value`
  await compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'toascribe',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ])
}

/** Forgets the failed-login and reset-request counts, so one test's attempts never lock out the next. */
export async function resetLimits(): Promise<void> {
  await compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'toascribe',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'delete from login_attempt',
  ])
}

interface MailpitMessage {
  ID: string
  Subject: string
}

async function mailpit<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${mailpitUrl()}/api/v1${path}`, init)
  if (!response.ok) {
    throw new Error(`Mailpit ${path}: ${response.status}`)
  }
  return (await response.json()) as T
}

/** Waits for a mail to `to` and returns its text. Mail goes through a queue and the worker, so it takes a moment. */
export async function waitForMail(to: string, subject?: RegExp): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const found = await mailpit<{ messages: MailpitMessage[] }>(`/search?query=${encodeURIComponent(`to:${to}`)}`)
    const message = found.messages.find((entry) => subject === undefined || subject.test(entry.Subject))
    if (message !== undefined) {
      return (await mailpit<{ Text: string }>(`/message/${message.ID}`)).Text
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`no mail to ${to} within 30 s`)
}

/** True when no mail to `to` has arrived (after the caller has waited long enough). */
export async function hasMail(to: string): Promise<boolean> {
  const found = await mailpit<{ messages: MailpitMessage[] }>(`/search?query=${encodeURIComponent(`to:${to}`)}`)
  return found.messages.length > 0
}

/** The link to a screen of the admin in a mail's text: `/admin/login?action=...#token=...`. */
export function linkIn(text: string, action: string): string {
  const match = new RegExp(`https?://[^\\s"<>]+/admin/login\\?action=${action}#token=[A-Za-z0-9_-]+`).exec(text)
  if (match === null) {
    throw new Error(`no ${action} link in the mail:\n${text}`)
  }
  return match[0]
}
