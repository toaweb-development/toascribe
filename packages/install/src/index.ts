// @toascribe/install: the install service that the setup wizard's API and `toa core install` share (M0.4). Node only: it
// uses the database, the password hash and the system's random source, but no HTTP framework.
export { EmailSettings, markEmailVerified } from './email-verified.ts'
export type { EmailVerifiedInput } from './email-verified.ts'
export { AlreadyInstalledError, INSTALL_ERROR_CODE, InstallError } from './errors.ts'
export type { InstallErrorCode } from './errors.ts'
export { observeOrigin } from './observed-origin.ts'
export type { ObservedOrigin, RequestAddressHeaders } from './observed-origin.ts'
export {
  RECOVERY_KEY_VERIFIER_LABEL,
  generateRecoveryKey,
  normalizeRecoveryKey,
  recoveryKeyVerifier,
  verifyRecoveryKey,
} from './recovery-key.ts'
export { createInstallService } from './service.ts'
export type {
  InstallInput,
  InstallMail,
  InstallResult,
  InstallService,
  InstallServiceDeps,
  ProxyReport,
} from './service.ts'
