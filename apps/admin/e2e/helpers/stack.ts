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

/** A running stack the tests talk to: its compose project, its env file and its two addresses. */
export interface Stack {
  project: string
  envFile: string
  baseUrl: string
  mailpitUrl: string
}

/** The stack `e2e/stack.sh up` started (the sign-in screens' tests run against it). */
export const mainStack = (): Stack => ({
  project: env('E2E_PROJECT'),
  envFile: env('E2E_ENV_FILE'),
  baseUrl: env('E2E_BASE_URL'),
  mailpitUrl: env('E2E_MAILPIT_URL'),
})

/**
 * The stack of its own that the setup wizard's test starts from an empty database (wizard.spec.ts): another project name,
 * other ports and its own scratch env file, so it never touches the main stack. The names are stack.sh's, given the variables
 * below.
 */
export const WIZARD_STACK_ENV = {
  E2E_PROJECT: 'toascribe-e2e-setup',
  E2E_HTTP_PORT: '18081',
  E2E_MAILPIT_PORT: '18026',
  // The `edge` network's subnet is fixed in compose.yaml, so a second stack at the same time needs another.
  E2E_EDGE_SUBNET: '10.231.98.0/24',
} as const

export const wizardStack = (): Stack => {
  const state = `${process.env.TMPDIR ?? '/tmp'}/${WIZARD_STACK_ENV.E2E_PROJECT}`
  return {
    project: WIZARD_STACK_ENV.E2E_PROJECT,
    envFile: `${state}/env`,
    baseUrl: `http://localhost:${WIZARD_STACK_ENV.E2E_HTTP_PORT}`,
    mailpitUrl: `http://localhost:${WIZARD_STACK_ENV.E2E_MAILPIT_PORT}`,
  }
}

export const baseUrl = (): string => mainStack().baseUrl

/**
 * `docker compose` for an e2e project (the main stack unless another is given); resolves with stdout. `input` goes to standard
 * input (passwords never go in arguments).
 */
export function compose(args: readonly string[], input?: string, stack: Stack = mainStack()): Promise<string> {
  const full = [
    'compose',
    '-p',
    stack.project,
    '-f',
    `${REPO_ROOT}docker/compose.yaml`,
    '--env-file',
    stack.envFile,
    '--profile',
    'mailpit',
    ...args,
  ]
  return new Promise((resolve, reject) => {
    const child = execFile('docker', full, { maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
      if (error !== null) {
        // `exitCode` is the command's own exit status (`toa core is-installed` answers 1 for "not installed").
        reject(
          Object.assign(new Error(`docker compose ${args.join(' ')} failed: ${stderr || error.message}`), {
            exitCode: typeof error.code === 'number' ? error.code : undefined,
          }),
        )
      } else {
        resolve(stdout)
      }
    })
    child.stdin?.end(input ?? '')
  })
}

const STACK_SH = fileURLToPath(new URL('../stack.sh', import.meta.url))

/** Runs `stack.sh <command>` for the wizard's own stack (its project name and ports come from `WIZARD_STACK_ENV`). */
function wizardStackSh(command: 'up' | 'down'): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'bash',
      [STACK_SH, command],
      { env: { ...process.env, ...WIZARD_STACK_ENV }, maxBuffer: 50_000_000, timeout: 600_000 },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve()
        } else {
          reject(new Error(`stack.sh ${command} (wizard stack) failed: ${stderr || error.message}`))
        }
      },
    )
  })
}

/**
 * Gives the wizard an empty database: its stack is taken down with its volumes (only this project's) and started again, so
 * every container, the api's and the admin's memory of "installed" included, starts from nothing. Called once per width.
 */
export async function resetWizardStack(): Promise<void> {
  await wizardStackSh('down')
  await wizardStackSh('up')
}

/** The text a service of a stack has logged so far. */
export function serviceLog(service: string, stack: Stack): Promise<string> {
  return compose(['logs', '--no-log-prefix', service], undefined, stack)
}

/**
 * The setup code, read from the api's log like the person who started the stack reads it (`docker compose logs api`): the
 * address in the one line the api writes at start-up, while the site is not installed.
 */
export async function setupTokenFromLog(stack: Stack): Promise<string> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const found = /\/admin\/setup\?token=([A-Za-z0-9_-]+)/.exec(await serviceLog('api', stack))
    if (found?.[1] !== undefined) {
      return found[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('the api did not log a setup code')
}

/** The administrator that `ensureInstalled` makes, for the specs that need to know who is signed in first. */
export const INSTALL_ADMIN = { username: 'e2eadmin', email: 'e2eadmin@example.test' } as const

/**
 * The sign-in screens need an installed site: until it is installed every page goes to the setup wizard. Installs the main
 * stack through the CLI (`toa core install`, the same service as the wizard) when it is not installed yet, and does nothing
 * when it is. The wizard has a stack of its own and an empty database (wizard.spec.ts).
 */
export async function ensureInstalled(): Promise<void> {
  try {
    await compose(['exec', '-T', 'api', 'toa', 'core', 'is-installed'])
    return
  } catch (caught) {
    if (!(caught instanceof Error && 'exitCode' in caught && caught.exitCode === 1)) {
      throw caught
    }
  }
  await compose(
    [
      'exec',
      '-T',
      'api',
      'toa',
      'core',
      'install',
      '--url',
      baseUrl(),
      '--title',
      'E2E',
      '--admin-user',
      INSTALL_ADMIN.username,
      '--admin-email',
      INSTALL_ADMIN.email,
      '--admin-password-stdin',
      // The api container has no SMTP settings (the worker has); the sign-in tests do not need the site's own mail setup.
      '--skip-email',
    ],
    PASSWORD,
  )
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

async function mailpit<T>(path: string, stack: Stack, init?: RequestInit): Promise<T> {
  const response = await fetch(`${stack.mailpitUrl}/api/v1${path}`, init)
  if (!response.ok) {
    throw new Error(`Mailpit ${path}: ${response.status}`)
  }
  return (await response.json()) as T
}

/** Waits for a mail to `to` and returns its text. Mail goes through a queue and the worker, so it takes a moment. */
export async function waitForMail(to: string, subject?: RegExp, stack: Stack = mainStack()): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const found = await mailpit<{ messages: MailpitMessage[] }>(
      `/search?query=${encodeURIComponent(`to:${to}`)}`,
      stack,
    )
    const message = found.messages.find((entry) => subject === undefined || subject.test(entry.Subject))
    if (message !== undefined) {
      return (await mailpit<{ Text: string }>(`/message/${message.ID}`, stack)).Text
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`no mail to ${to} within 30 s`)
}

/** True when no mail to `to` has arrived (after the caller has waited long enough). */
export async function hasMail(to: string): Promise<boolean> {
  const found = await mailpit<{ messages: MailpitMessage[] }>(
    `/search?query=${encodeURIComponent(`to:${to}`)}`,
    mainStack(),
  )
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
