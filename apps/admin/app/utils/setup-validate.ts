import { NewPassword, SetupSite, SetupToken, Username } from '@toascribe/shared'

import type { FieldError, KeyTranslator } from './auth-validate.ts'

// Checks for the setup wizard's forms, in the same shape as auth-validate.ts: they catch what can be seen without the server
// so a person is told before a call is made, and the api checks everything again (the shared `Setup*` schemas). The messages
// come from i18n, so the translator is passed in.

/** The shared rule for an e-mail address (the one the api applies to the site's and the administrator's). */
const Email = SetupSite.shape.adminEmail
const TIMEZONE_MAX = 64
const FREE_TEXT_MAX = 200

function emailError(name: string, value: string, t: KeyTranslator): FieldError[] {
  return Email.safeParse(value.trim()).success ? [] : [{ name, message: t('auth.validation.email') }]
}

/** The pasted setup code. The api makes 43 characters of base64url; pasting often brings spaces and a line break along. */
export function validateSetupToken(state: { token?: string }, t: KeyTranslator): FieldError[] {
  return SetupToken.safeParse((state.token ?? '').trim()).success
    ? []
    : [{ name: 'token', message: t('setup.validation.token') }]
}

export function validateSetupSite(
  state: { title?: string; timezone?: string; adminEmail?: string },
  t: KeyTranslator,
  knownZones: readonly string[],
): FieldError[] {
  const errors: FieldError[] = []
  const title = (state.title ?? '').trim()
  if (title === '' || title.length > FREE_TEXT_MAX || /\p{Cc}/u.test(title)) {
    errors.push({ name: 'title', message: t('setup.validation.title') })
  }
  const zone = state.timezone ?? ''
  if (zone === '' || zone.length > TIMEZONE_MAX || !knownZones.includes(zone)) {
    errors.push({ name: 'timezone', message: t('setup.validation.timezone') })
  }
  errors.push(...emailError('adminEmail', state.adminEmail ?? '', t))
  return errors
}

/** The port is optional (the encryption picks the usual one); when given it is a whole number from 1 to 65535. */
export function validateSetupEmail(
  state: { host?: string; port?: string; fromAddress?: string; username?: string; fromName?: string },
  t: KeyTranslator,
): FieldError[] {
  const errors: FieldError[] = []
  const host = (state.host ?? '').trim()
  if (host === '' || host.length > 253 || /[\s\p{Cc}/]/u.test(host)) {
    errors.push({ name: 'host', message: t('setup.validation.host') })
  }
  const port = (state.port ?? '').trim()
  if (port !== '' && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535)) {
    errors.push({ name: 'port', message: t('setup.validation.port') })
  }
  if (/\p{Cc}/u.test(state.username ?? '') || (state.username ?? '').length > 320) {
    errors.push({ name: 'username', message: t('setup.validation.smtpUsername') })
  }
  errors.push(...emailError('fromAddress', state.fromAddress ?? '', t))
  if (/\p{Cc}/u.test(state.fromName ?? '') || (state.fromName ?? '').length > FREE_TEXT_MAX) {
    errors.push({ name: 'fromName', message: t('setup.validation.fromName') })
  }
  return errors
}

export function validateSetupTestRecipient(state: { to?: string }, t: KeyTranslator): FieldError[] {
  return emailError('to', state.to ?? '', t)
}

export function validateSetupAdmin(
  state: { username?: string; email?: string; password?: string },
  t: KeyTranslator,
): FieldError[] {
  const errors: FieldError[] = []
  const username = (state.username ?? '').trim()
  const email = (state.email ?? '').trim()
  const password = state.password ?? ''
  if (!Username.safeParse(username).success) {
    errors.push({ name: 'username', message: t('auth.validation.username') })
  }
  errors.push(...emailError('email', email, t))
  if (!NewPassword.safeParse(password).success) {
    errors.push({ name: 'password', message: t('auth.validation.newPassword') })
  } else if (password.toLowerCase() === username.toLowerCase() || password.toLowerCase() === email.toLowerCase()) {
    errors.push({ name: 'password', message: t('setup.validation.passwordSame') })
  }
  return errors
}

/** The zones to choose from: what the browser knows, plus UTC (some browsers leave it out of the list). */
export function timezoneChoices(supported: readonly string[] | undefined): string[] {
  const zones = new Set(supported ?? [])
  zones.add('Europe/Oslo')
  zones.add('UTC')
  return [...zones].sort((a, b) => a.localeCompare(b, 'en'))
}
