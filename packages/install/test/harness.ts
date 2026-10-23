// A real PostgreSQL for the install service tests: a migrated database, the app role's client (what the api and the cli
// use), the owner's pool for set-up and for reads the app role may not do, and a service built on them.
import { runMigrations, createDb, seedCore } from '@toascribe/db'
import { createKeyRing, parseKeyMaterial } from '@toascribe/shared'
import type { EmailMessage } from '@toascribe/shared'
import pg from 'pg'
import { pino } from 'pino'

import { createInstallService } from '../src/service.ts'
import type { InstallMail, InstallService, InstallServiceDeps } from '../src/service.ts'
import { createTestDatabase } from './db.ts'
import type { TestDatabase } from './db.ts'

export const TEST_ORIGIN = 'https://cms.example.test'
export const TEST_ENCRYPTION_KEY = parseKeyMaterial('1f2e3d4c5b6a79881706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0')
export const testKeyRing = await createKeyRing({ version: 1, key: TEST_ENCRYPTION_KEY })

export const PASSWORD = 'a long and fine password'

export const SITE = {
  locale: 'nb',
  title: 'Min blogg',
  timezone: 'Europe/Oslo',
  adminEmail: 'ansvarlig@example.test',
  blogPublic: true,
} as const

export const SMTP = {
  host: 'smtp.example.test',
  port: 587,
  secure: 'starttls',
  username: 'mailer',
  password: 'smtp-secret-pw',
  fromAddress: 'noreply@cms.example.test',
} as const

export function admin(name = 'tor') {
  return { username: name, email: `${name}@example.test`, password: PASSWORD }
}

/** Counts of the things an install writes, read as the owner. */
export interface Footprint {
  readonly accounts: number
  readonly contents: number
  readonly comments: number
  readonly terms: number
  readonly auditInstalled: number
  readonly secrets: readonly string[]
  readonly notices: readonly string[]
}

export interface InstallEnv {
  readonly database: TestDatabase
  readonly service: InstallService
  readonly db: ReturnType<typeof createDb>['db']
  readonly owner: pg.Pool
  query: <R extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<R[]>
  setting: (key: string) => Promise<unknown>
  footprint: () => Promise<Footprint>
  /** Another service over the same database, for a test of a different configuration. */
  service2: (overrides?: Partial<InstallServiceDeps>) => InstallService
  close: () => Promise<void>
}

export async function startInstallEnv(options: Partial<InstallServiceDeps> = {}): Promise<InstallEnv> {
  const database = await createTestDatabase()
  try {
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })
    const { db, pool } = createDb({
      connectionString: database.appUrl,
      applicationName: 'toascribe-install-test',
      max: 6,
    })
    const owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    const deps: InstallServiceDeps = {
      db,
      keyRing: testKeyRing,
      publicOrigin: TEST_ORIGIN,
      logger: pino({ level: 'silent' }),
      signingKeyBytes: 32,
      // A test does not want «not installed» remembered: it flips the state in SQL and asks again.
      notInstalledCacheMs: 0,
      ...options,
    }
    const query = async <R extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await owner.query<R>(text, [...values])).rows
    return {
      database,
      service: createInstallService(deps),
      db,
      owner,
      query,
      async setting(key) {
        const rows = await query<{ value: unknown }>('select value from setting where key = $1', [key])
        return rows[0]?.value
      },
      async footprint() {
        const count = async (table: string) =>
          Number((await query<{ n: string }>(`select count(*) as n from ${table}`))[0]?.n)
        return {
          accounts: await count('account'),
          contents: await count('content'),
          comments: await count('comment'),
          terms: await count('term'),
          auditInstalled: Number(
            (await query<{ n: string }>(`select count(*) as n from audit_log where action = 'site.installed'`))[0]?.n,
          ),
          secrets: (await query<{ purpose: string }>('select purpose from site_secret order by purpose')).map(
            (r) => r.purpose,
          ),
          notices: (await query<{ key: string }>('select key from admin_notice order by key')).map((r) => r.key),
        }
      },
      service2: (overrides = {}) => createInstallService({ ...deps, ...overrides }),
      async close() {
        await Promise.all([pool.end(), owner.end()])
        await database.drop()
      },
    }
  } catch (err) {
    await database.drop()
    throw err
  }
}

/** Puts a table back to «as migrated»: for tests that install more than once on one database. */
export async function resetInstall(env: InstallEnv): Promise<void> {
  await env.owner.query(`
    truncate comment, content_author, content_term, content, term, audit_log, login_attempt, session, account_role, account,
             site_secret, admin_notice restart identity cascade`)
  await env.owner.query('delete from setting')
  await seedCore(env.db)
  env.service.forgetInstalled()
}

export interface RecordedMail {
  readonly message: EmailMessage
  readonly options: Parameters<InstallMail['sendMail']>[1]
}

/** A mail queue that records what it is given and answers `jobState` from a script. */
export function stubMail(script: {
  /** The state to report on the nth poll (the last one repeats). */
  readonly states: readonly ({ state: string; output?: unknown } | null)[]
  readonly jobId?: string | null
  readonly sendError?: Error
  readonly stateError?: Error
}): InstallMail & { readonly sent: RecordedMail[]; polls: number } {
  const sent: RecordedMail[] = []
  const mail = {
    sent,
    polls: 0,
    sendMail(message: EmailMessage, options: Parameters<InstallMail['sendMail']>[1]) {
      if (script.sendError !== undefined) {
        return Promise.reject(script.sendError)
      }
      sent.push({ message, options })
      return Promise.resolve({ jobId: script.jobId === undefined ? 'job-1' : script.jobId })
    },
    jobState() {
      if (script.stateError !== undefined) {
        return Promise.reject(script.stateError)
      }
      const index = Math.min(mail.polls, script.states.length - 1)
      mail.polls += 1
      const entry = script.states[index] ?? null
      return Promise.resolve(entry === null ? null : { state: entry.state, output: entry.output ?? null })
    },
  }
  return mail
}
