// A real app on a real PostgreSQL for the auth tests: migrated database, accounts in every built-in role, and a small HTTP
// client that keeps the session cookie and the CSRF token like a browser does. Later tasks (MFA, lost password, ...) build
// on it.
import { runMigrations } from '@toascribe/db'
import type { BuiltInRole } from '@toascribe/shared'
import { createDb } from '@toascribe/db'
import pg from 'pg'
import { pino } from 'pino'

import { buildApp } from '../src/app.ts'
import { hashPassword } from '../src/lib/passwords.ts'
import { createTestDatabase } from './db.ts'
import type { TestDatabase } from './db.ts'
import { TEST_ORIGIN, TEST_SIGNING_KEY, memoryLogger, recordingMail, testKeyRing } from './helpers.ts'

export const SESSION_COOKIE_NAME = '__Host-toa_session'

/** The password every test account has unless a test says otherwise. */
export const TEST_PASSWORD = 'correct horse battery staple'

let defaultHash: Promise<string> | undefined

export interface NewAccount {
  readonly username: string
  readonly email?: string
  readonly role?: BuiltInRole | readonly BuiltInRole[] | null
  readonly status?: 'active' | 'pending' | 'disabled'
  /** A stored hash to use as it is (an imported WordPress hash). Default: argon2id of TEST_PASSWORD. */
  readonly passwordHash?: string | null
  readonly displayName?: string
}

export interface CreatedAccount {
  readonly id: string
  readonly username: string
  readonly email: string
}

export interface ClientOptions {
  /** The address the proxy would put in X-Real-IP. */
  readonly ip?: string
  /** Sent as Origin. Default: the site's origin. `null` sends none. */
  readonly origin?: string | null
}

export interface RequestOptions {
  readonly json?: unknown
  readonly body?: string
  readonly headers?: Readonly<Record<string, string>>
  /** 'auto': the CSRF token of the logged-in session. 'none': send none. Otherwise: send this value. */
  readonly csrf?: 'auto' | 'none' | (string & {})
  /** Overrides the client's Origin for this request; `null` sends none. */
  readonly origin?: string | null
  /** Overrides Content-Type. `null` sends none. */
  readonly contentType?: string | null
  /** Overrides the client's cookie for this request. */
  readonly cookie?: string | null
}

type App = ReturnType<typeof buildApp>['app']

/** Keeps the session cookie and CSRF token between calls, like a browser tab. */
export class TestClient {
  cookie: string | undefined
  csrfToken: string | undefined
  lastSetCookie: string[] = []
  readonly #app: App
  readonly #ip: string
  readonly #origin: string | null

  constructor(app: App, options: ClientOptions = {}) {
    this.#app = app
    this.#ip = options.ip ?? '203.0.113.7'
    this.#origin = options.origin === undefined ? TEST_ORIGIN : options.origin
  }

  async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { 'x-real-ip': this.#ip, ...options.headers }
    const origin = options.origin === undefined ? this.#origin : options.origin
    if (origin !== null) {
      headers['origin'] = origin
    }
    const cookie = options.cookie === undefined ? this.cookie : (options.cookie ?? undefined)
    if (cookie !== undefined) {
      headers['cookie'] = cookie
    }
    const csrf = options.csrf ?? 'auto'
    if (csrf === 'auto') {
      if (this.csrfToken !== undefined) {
        headers['x-csrf-token'] = this.csrfToken
      }
    } else if (csrf !== 'none') {
      headers['x-csrf-token'] = csrf
    }
    let body: string | undefined
    if (options.json !== undefined) {
      body = JSON.stringify(options.json)
      headers['content-type'] = 'application/json'
    } else if (options.body !== undefined) {
      body = options.body
    }
    if (options.contentType !== undefined) {
      if (options.contentType === null) {
        delete headers['content-type']
      } else {
        headers['content-type'] = options.contentType
      }
    }
    const res = await this.#app.request(path, { method, headers, ...(body === undefined ? {} : { body }) })
    this.#remember(res)
    return res
  }

  get(path: string, options?: RequestOptions) {
    return this.request('GET', path, options)
  }

  post(path: string, json?: unknown, options?: RequestOptions) {
    return this.request('POST', path, { ...(json === undefined ? {} : { json }), ...options })
  }

  patch(path: string, json: unknown, options?: RequestOptions) {
    return this.request('PATCH', path, { json, ...options })
  }

  delete(path: string, options?: RequestOptions) {
    return this.request('DELETE', path, options)
  }

  /** Signs in through the real endpoint. Keeps the cookie and the CSRF token when it works. */
  async login(login: string, password: string, extra: { remember?: boolean; redirectTo?: string } = {}) {
    const res = await this.post('/api/v1/auth/login', { login, password, ...extra }, { csrf: 'none' })
    if (res.status === 200) {
      const body: unknown = await res.clone().json()
      if (typeof body === 'object' && body !== null && 'csrfToken' in body && typeof body.csrfToken === 'string') {
        this.csrfToken = body.csrfToken
      }
    }
    return res
  }

  #remember(res: Response): void {
    this.lastSetCookie = res.headers.getSetCookie()
    for (const line of this.lastSetCookie) {
      if (!line.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        continue
      }
      const pair = line.split(';')[0] ?? ''
      const value = pair.slice(SESSION_COOKIE_NAME.length + 1)
      if (value === '' || /;\s*Max-Age=0/i.test(line)) {
        this.cookie = undefined
        this.csrfToken = undefined
      } else {
        this.cookie = pair
      }
    }
  }

  /** The raw token in the cookie, for tests that compare it with the database. */
  get sessionToken(): string | undefined {
    return this.cookie?.slice(SESSION_COOKIE_NAME.length + 1)
  }
}

export interface AuthTestApp {
  readonly database: TestDatabase
  readonly app: App
  readonly services: ReturnType<typeof buildApp>['services']
  /** The app role's pool: what the api itself uses. */
  readonly pool: pg.Pool
  /** The owner's pool, for setup and reads the app role may not do. */
  readonly owner: pg.Pool
  readonly lines: ReturnType<typeof memoryLogger>['lines']
  readonly mail: ReturnType<typeof recordingMail>
  /** The test clock. Starts at the real time; `setNow` pins it, `advance` moves it. */
  readonly clock: { now: () => Date; set: (at: Date) => void; advance: (ms: number) => void }
  createAccount: (input: NewAccount) => Promise<CreatedAccount>
  client: (options?: ClientOptions) => TestClient
  query: <R extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<R[]>
  close: () => Promise<void>
}

export async function startAuthApp(options: { readonly publicOrigin?: string } = {}): Promise<AuthTestApp> {
  const database = await createTestDatabase()
  try {
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })
    const { db, pool } = createDb({ connectionString: database.appUrl, applicationName: 'toascribe-api-test', max: 5 })
    const owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    const log = memoryLogger()
    const mail = recordingMail()
    let pinned: Date | undefined
    let offsetMs = 0
    const clock = {
      now: () => pinned ?? new Date(Date.now() + offsetMs),
      set: (at: Date) => {
        pinned = at
      },
      advance: (ms: number) => {
        if (pinned === undefined) {
          offsetMs += ms
        } else {
          pinned = new Date(pinned.getTime() + ms)
        }
      },
    }
    const built = buildApp({
      pool,
      db,
      logger: log.logger,
      version: '9.9.9',
      publicOrigin: options.publicOrigin ?? TEST_ORIGIN,
      signingKey: TEST_SIGNING_KEY,
      keyRing: testKeyRing,
      mail,
      clock: clock.now,
    })

    const roleIds = new Map<string, string>()
    for (const row of (await owner.query<{ id: string; slug: string }>('select id, slug from role')).rows) {
      roleIds.set(row.slug, row.id)
    }

    return {
      database,
      app: built.app,
      services: built.services,
      pool,
      owner,
      lines: log.lines,
      mail,
      clock,

      async createAccount(input) {
        defaultHash ??= hashPassword(TEST_PASSWORD)
        const email = input.email ?? `${input.username}@example.test`
        const passwordHash = input.passwordHash === undefined ? await defaultHash : input.passwordHash
        const { rows } = await owner.query<{ id: string }>(
          `insert into account (username, email, display_name, nicename, password_hash, status)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [
            input.username,
            email,
            input.displayName ?? input.username,
            input.username.toLowerCase(),
            passwordHash,
            input.status ?? 'active',
          ],
        )
        const id = rows[0]?.id
        if (id === undefined) {
          throw new Error('the account insert returned no row')
        }
        const roles = input.role === undefined ? ['subscriber'] : input.role === null ? [] : [input.role].flat()
        for (const slug of roles) {
          const roleId = roleIds.get(slug)
          if (roleId === undefined) {
            throw new Error(`no role ${slug}`)
          }
          await owner.query('insert into account_role (account_id, role_id) values ($1, $2)', [id, roleId])
        }
        return { id, username: input.username, email }
      },

      client: (clientOptions) => new TestClient(built.app, clientOptions),

      async query<R extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []) {
        return (await owner.query<R>(text, [...values])).rows
      },

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

export const ROLES: readonly BuiltInRole[] = ['administrator', 'editor', 'author', 'contributor', 'subscriber']
