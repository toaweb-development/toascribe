// What the install service refuses with. The api turns each into a status and the cli into a message and an exit code. The
// messages are safe to show: they name fields and steps, never values.
import { AlreadyInstalledError } from '@toascribe/db'

export { AlreadyInstalledError }

export const INSTALL_ERROR_CODE = [
  /** A step the install needs is not saved yet (`step` says which). */
  'step_missing',
  /** The administrator's username is taken. */
  'username_taken',
  /** The administrator's e-mail address is taken. */
  'email_taken',
  /** The recovery key sent back is not the one the server made last. */
  'recovery_key_mismatch',
  /** The database already holds some of the default content (a post or page with the same address). */
  'content_exists',
  /** The administrator's password is the username or the e-mail address (the same rule as every other way to choose a password). */
  'weak_password',
  /** The input does not pass its schema (only the CLI can get here: the api validates before it calls). */
  'invalid_input',
] as const
export type InstallErrorCode = (typeof INSTALL_ERROR_CODE)[number]

export class InstallError extends Error {
  override readonly name = 'InstallError'
  readonly code: InstallErrorCode

  constructor(code: InstallErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}
