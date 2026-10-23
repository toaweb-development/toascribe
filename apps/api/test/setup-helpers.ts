// Shared by the setup tests: the steps of the wizard as HTTP calls, and a way to put a test database back to «not installed».
import { runMigrations } from '@toascribe/db'
import { SETUP_TOKEN_HEADER, SetupRecoveryKeyResponse } from '@toascribe/shared'
import { pino } from 'pino'

import type { AuthTestApp, TestClient } from './harness.ts'

export const SITE = {
  locale: 'nb',
  title: 'Min blogg',
  timezone: 'Europe/Oslo',
  adminEmail: 'ansvarlig@example.test',
  blogPublic: true,
} as const

export const ADMIN = { username: 'tor', email: 'tor@example.test', password: 'a long and fine password' } as const

/** A request to a setup route with the token in its header, as the wizard sends it. */
export function setupCall(
  client: TestClient,
  method: string,
  path: string,
  token: string | undefined,
  json?: unknown,
  extra: { readonly headers?: Record<string, string>; readonly origin?: string | null } = {},
) {
  return client.request(method, `/api/v1/setup${path}`, {
    csrf: 'none',
    ...(json === undefined ? {} : { json }),
    headers: { ...(token === undefined ? {} : { [SETUP_TOKEN_HEADER]: token }), ...extra.headers },
    ...(extra.origin === undefined ? {} : { origin: extra.origin }),
  })
}

/** The truncated tables, in one statement. `role` and `taxonomy` stay: they are seed data. */
const CLEAR = `truncate comment, content_author, content_term, content, term, audit_log, login_attempt, session, account_token,
  account_role, account, site_secret, admin_notice restart identity cascade`

/** Puts the database back to what the migrations and the seed leave, and makes the app forget that it was installed. */
export async function resetSite(env: AuthTestApp): Promise<void> {
  await env.owner.query(CLEAR)
  await env.owner.query('delete from setting')
  await runMigrations({ connectionString: env.database.ownerUrl, logger: pino({ level: 'silent' }) })
  env.services.install.forgetInstalled()
}

/** Everything the wizard does before the last act, with the e-mail step skipped. Returns the recovery key. */
export async function prepareInstall(client: TestClient, token: string): Promise<string> {
  const site = await setupCall(client, 'PUT', '/site', token, SITE)
  if (site.status !== 200) {
    throw new Error(`site step: ${String(site.status)}`)
  }
  const skip = await setupCall(client, 'POST', '/email/skip', token)
  if (skip.status !== 200) {
    throw new Error(`skip step: ${String(skip.status)}`)
  }
  const key = await setupCall(client, 'POST', '/recovery-key', token)
  if (key.status !== 200) {
    throw new Error(`recovery key: ${String(key.status)}`)
  }
  return SetupRecoveryKeyResponse.parse(await key.json()).recoveryKey
}
