import type { SetupStep } from '@toascribe/shared'

// The order of the wizard and what a failed call means for it (M0.4). Pure, so a test needs no browser.

/** The seven steps, in the order of Tor's specification. Index 0 is the first. */
export const WIZARD_STEPS = ['token', 'check', 'site', 'email', 'admin', 'content', 'finish'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step)
}

/**
 * Where a reload lands: the api says which step is the first not saved (`check`, `site`, `email`, `admin`). The steps after
 * `admin` (what will be made, and the install) have nothing to save, and the administrator is not saved either (it is made in
 * the install), so a reload during them starts at `admin`.
 */
export function stepFor(next: SetupStep): number {
  return stepIndex(next)
}

/** What a failed setup call means. */
export type SetupFailure =
  /** 404 (or 409 `already_installed`): the site is installed; the wizard is over. */
  | { kind: 'installed' }
  /** 401: the token is missing or wrong. Back to the first step. */
  | { kind: 'token' }
  /** Anything else: a message for the step that made the call. */
  | { kind: 'other' }

export function classifySetupFailure(caught: unknown): SetupFailure {
  // An ApiRequestError, read by its fields (a test needs no Nuxt layer).
  if (typeof caught !== 'object' || caught === null) {
    return { kind: 'other' }
  }
  const { status, code } = caught as { status?: unknown; code?: unknown }
  if (status === 404 || code === 'already_installed') {
    return { kind: 'installed' }
  }
  if (status === 401 && (code === 'invalid_setup_token' || code === 'setup_token_required')) {
    return { kind: 'token' }
  }
  return { kind: 'other' }
}

/**
 * Whether a failed install is the administrator step's to fix: a taken name or address, or a key that is not the last one
 * made. The wizard goes back there with the message. (`step_missing` is another step's: the wizard asks the api which.)
 */
export function isAdminStepFailure(code: string): boolean {
  return code === 'username_taken' || code === 'email_taken' || code === 'recovery_key_mismatch'
}
