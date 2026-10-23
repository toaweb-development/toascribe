import { ApiRequestError } from './errors.ts'

/** vue-i18n's `t`, as far as it is used here: a key, and the number for a plural message or the named values. */
export type Translate = (key: string, named?: Record<string, string | number> | number) => string

/** «30 sekunder», «5 minutter», «2 timer». A silly wait is rounded up to the next unit, never down to zero. */
export function describeWait(seconds: number, t: Translate): string {
  if (seconds < 90) {
    const n = Math.max(1, Math.ceil(seconds))
    return t('error.wait.seconds', n)
  }
  if (seconds < 5400) {
    return t('error.wait.minutes', Math.ceil(seconds / 60))
  }
  return t('error.wait.hours', Math.ceil(seconds / 3600))
}

/**
 * The text for a failed API call: what happened and what to do next (content design, «Errors»). The API's own `message`
 * is English and may name fields, so it is not shown; a code maps to a message here. Nothing says whether an account
 * exists: «invalid_credentials» is the same for a wrong password, an unknown name and a locked account.
 *
 * `requestId` is for support: it is added to a message that has no better advice than «try again».
 */
export function describeApiError(error: unknown, t: Translate): string {
  if (!(error instanceof ApiRequestError)) {
    return t('error.unknown')
  }
  switch (error.code) {
    case 'invalid_credentials':
      return t('error.invalidCredentials')
    case 'unauthorized':
      return t('error.unauthorized')
    case 'mfa_required':
      return t('error.mfaRequired')
    case 'forbidden':
      return t('error.forbidden')
    case 'invalid_password':
      return t('error.invalidPassword')
    case 'password_required':
      return t('error.passwordRequired')
    case 'invalid_code':
      return t('error.invalidCode')
    case 'registration_closed':
      return t('error.registrationClosed')
    case 'registration_unavailable':
      return t('error.registrationUnavailable')
    case 'invalid_token':
      return t('error.invalidToken')
    case 'weak_password':
      return t('error.weakPassword')
    case 'same_email':
      return t('error.sameEmail')
    case 'email_unavailable':
      return t('error.emailUnavailable')
    case 'setup_token_required':
      return t('error.setupTokenRequired')
    case 'invalid_setup_token':
      return t('error.invalidSetupToken')
    case 'already_installed':
      return t('error.alreadyInstalled')
    case 'step_missing':
      return t('error.stepMissing')
    case 'username_taken':
      return t('error.usernameTaken')
    case 'email_taken':
      return t('error.emailTaken')
    case 'content_exists':
      return t('error.contentExists')
    case 'recovery_key_mismatch':
      return t('error.recoveryKeyMismatch')
    case 'origin_invalid':
      return t('error.originInvalid')
    case 'validation_error':
      return t('error.validation')
    case 'mfa_not_pending':
    case 'enrolment_finished':
      return t('error.mfaFinished')
    case 'enrolment_unreadable':
      return t('error.enrolmentUnreadable')
    case 'too_many_requests':
      return error.retryAfterSeconds === undefined
        ? t('error.tooManyRequests')
        : t('error.tooManyRequestsIn', { wait: describeWait(error.retryAfterSeconds, t) })
    case 'network':
    case 'timeout':
      return t('error.network')
    default:
      return error.requestId === undefined ? t('error.server') : t('error.serverWithReference', { id: error.requestId })
  }
}
