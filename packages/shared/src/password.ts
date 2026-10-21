import { z } from 'zod'

// Password input rules (K-310). The upper bound is WordPress' own (`wp_check_password` refuses anything longer) and keeps a
// huge string from being fed to the hash function: argon2id and the imported formats all do work proportional to the input.

export const PASSWORD_MAX_LENGTH = 4096

/** NIST SP 800-63B §5.1.1.2: at least 8 characters when a person chooses the password. Not checked at login. */
export const PASSWORD_MIN_LENGTH = 8

/**
 * What a login form sends. Only bounded, never judged: a password that was valid under an older rule or an import must
 * still be accepted. It is not trimmed (WordPress' `wp_check_password` does not trim either) and not normalised.
 */
export const LoginPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH)

/** A password someone chooses (set password, reset, change): same upper bound, plus the length floor. */
export const NewPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
