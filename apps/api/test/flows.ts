// Helpers for the account-flow tests (second factor, lost password, registration, e-mail change).
import { ApiError } from '@toascribe/shared'

import type { MailRequest } from '../src/ports/mail.ts'
import { totpCodeAt } from '../src/lib/totp.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

/** A base counter so every test gets addresses and names of its own. */
let counter = 0
export const unique = (base: string): string => `${base}${String((counter += 1))}`

/** Sets a setting the way the settings page will (the owner role, as the tests' setup may do anything). */
export async function setSetting(env: AuthTestApp, key: string, value: unknown): Promise<void> {
  await env.query(`update setting set value = $1::jsonb where key = $2`, [JSON.stringify(value), key])
}

/** A JSON object body. The fields the tests read are named, so they can be read with a dot. */
export type JsonBody = Record<string, unknown> & {
  status?: unknown
  mfa?: unknown
  account?: unknown
  recoveryCodes?: unknown
  id?: unknown
  secret?: unknown
}

export async function readJson(res: Response): Promise<JsonBody> {
  const body: unknown = await res.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('the response is not a JSON object')
  }
  return Object.fromEntries(Object.entries(body))
}

/** The mails the recording port was asked to send to an address, oldest first. */
export function mailsTo(env: AuthTestApp, to: string): MailRequest[] {
  return env.mail.sent.filter((mail) => mail.to.toLowerCase() === to.toLowerCase())
}

/** The token of the newest mail of a template to an address. Throws when there is none. */
export function tokenOf(env: AuthTestApp, template: MailRequest['template'], to: string): string {
  const found = mailsTo(env, to)
    .filter((mail) => mail.template === template)
    .at(-1)
  if (found === undefined || !('token' in found.data)) {
    throw new Error(`no ${template} mail with a token to ${to}`)
  }
  return found.data.token
}

export interface Enrolled {
  readonly id: string
  readonly secret: string
  /** All ten, as printed, when this was the first factor. */
  readonly recoveryCodes: string[] | null
  readonly response: Response
}

/** The code the authenticator app shows now (by the test clock). */
export function codeNow(env: AuthTestApp, secret: string, offsetSeconds = 0): string {
  return totpCodeAt(secret, env.clock.now().getTime() + offsetSeconds * 1000)
}

/** Moves the test clock to the next time step, so the code of the step just used is in the past. */
export function nextStep(env: AuthTestApp): void {
  env.clock.advance(30_000)
}

/** Enrols an authenticator app for the account `client` is signed in as, through the real endpoints. */
export async function enrolTotp(env: AuthTestApp, client: TestClient, name?: string): Promise<Enrolled> {
  const started = await client.post('/api/v1/me/mfa/totp', name === undefined ? {} : { name })
  if (started.status !== 201) {
    throw new Error(`enrolment did not start: ${String(started.status)}`)
  }
  const body = await readJson(started)
  const id = String(body.id)
  const secret = String(body.secret)
  const response = await client.post(`/api/v1/me/mfa/totp/${id}/confirm`, { code: codeNow(env, secret) })
  const confirmed = response.status === 200 ? await readJson(response.clone()) : {}
  const codes = confirmed.recoveryCodes
  return {
    id,
    secret,
    recoveryCodes: Array.isArray(codes) ? codes.map(String) : null,
    response,
  }
}

/** The `error.code` of an ApiError response. */
export async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code
}
