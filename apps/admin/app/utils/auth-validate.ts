import { NewPassword, RegisterRequest, TotpCode } from '@toascribe/shared'

// Checks for the sign-in forms. They only catch what can be seen without the server (empty, wrong shape), so the person
// is told before a call is made; the API checks everything again. Each returns the errors in the shape `UForm` wants:
// `{ name, message }` with `name` the field. The messages come from i18n, so they are passed in.

export interface FieldError {
  name: string
  message: string
}

export type KeyTranslator = (key: string) => string

export function validateLogin(state: { login?: string; password?: string }, t: KeyTranslator): FieldError[] {
  const errors: FieldError[] = []
  if ((state.login ?? '').trim() === '') {
    errors.push({ name: 'login', message: t('auth.validation.loginRequired') })
  }
  if ((state.password ?? '') === '') {
    errors.push({ name: 'password', message: t('auth.validation.passwordRequired') })
  }
  return errors
}

export function validateLostPassword(state: { login?: string }, t: KeyTranslator): FieldError[] {
  return (state.login ?? '').trim() === '' ? [{ name: 'login', message: t('auth.validation.loginRequired') }] : []
}

export function validateNewPassword(state: { password?: string }, t: KeyTranslator): FieldError[] {
  return NewPassword.safeParse(state.password ?? '').success
    ? []
    : [{ name: 'password', message: t('auth.validation.newPassword') }]
}

export function validateRegister(state: { username?: string; email?: string }, t: KeyTranslator): FieldError[] {
  const result = RegisterRequest.safeParse({
    username: (state.username ?? '').trim(),
    email: (state.email ?? '').trim(),
  })
  if (result.success) {
    return []
  }
  const failed = new Set(result.error.issues.map((issue) => issue.path[0]))
  const errors: FieldError[] = []
  if (failed.has('username')) {
    errors.push({ name: 'username', message: t('auth.validation.username') })
  }
  if (failed.has('email')) {
    errors.push({ name: 'email', message: t('auth.validation.email') })
  }
  return errors
}

/** The six-digit code of the authenticator app. «123 456» is fine. */
export function validateTotpCode(state: { code?: string }, t: KeyTranslator): FieldError[] {
  return TotpCode.safeParse(state.code ?? '').success ? [] : [{ name: 'code', message: t('auth.validation.totpCode') }]
}

/** A recovery code: printed as `ABCD-EFGH-JKMN-PQRS`; case and separators are ignored by the API. */
export function validateRecoveryCode(state: { code?: string }, t: KeyTranslator): FieldError[] {
  const letters = (state.code ?? '').replace(/[\s-]/g, '')
  return letters.length >= 8 ? [] : [{ name: 'code', message: t('auth.validation.recoveryCode') }]
}

/** What the API gets for a code: without the spaces around it, as typed otherwise. */
export function cleanCode(code: string): string {
  return code.trim()
}
