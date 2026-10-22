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

// ── Choosing a password (K-013) ──────────────────────────────

/** 0 (unusable) to 4 (strong): what the strength meter on the set-password screens shows. */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4

/**
 * An indication for the strength meter, not a gate: the api only enforces `NewPassword` (NIST SP 800-63B: length, no
 * composition rules). Length is what counts; a password that is one character class or has very few different characters
 * is held a step back. A password list or zxcvbn-style analysis may replace this later without changing the contract.
 */
export function passwordStrength(password: string): PasswordStrength {
  const length = Array.from(password).length
  if (length < PASSWORD_MIN_LENGTH) {
    return 0
  }
  let score: PasswordStrength = length >= 24 ? 4 : length >= 16 ? 3 : length >= 12 ? 2 : 1
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((pattern) =>
    pattern.test(password),
  ).length
  const distinct = new Set(password).size
  if ((classes < 2 && length < 16) || distinct < 5) {
    score = Math.max(0, score - 1) as PasswordStrength
  }
  return score
}

// No 0/O, 1/l/I: a generated password is often read off a screen.
const GENERATED_LOWER = 'abcdefghijkmnopqrstuvwxyz'
const GENERATED_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const GENERATED_DIGITS = '23456789'
const GENERATED_SYMBOLS = '!@#$%^&*-_=+?'
const GENERATED_ALL = GENERATED_LOWER + GENERATED_UPPER + GENERATED_DIGITS + GENERATED_SYMBOLS

/** The length «Generate password» makes, as WordPress does (24). */
export const GENERATED_PASSWORD_LENGTH = 24

/** A uniformly random index below `limit`, by rejection sampling so there is no modulo bias. */
function randomIndex(limit: number): number {
  const range = 0x1_0000_0000
  const ceiling = range - (range % limit)
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < ceiling) {
      return value % limit
    }
  }
}

/**
 * «Generate password» (K-013): random characters from WebCrypto, with at least one lower-case letter, one upper-case letter,
 * one digit and one symbol. It runs in the browser, so the password is never sent anywhere before the person submits it
 * with the form; the api has no endpoint that makes passwords.
 */
export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  if (!Number.isInteger(length) || length < 12 || length > 128) {
    throw new RangeError('a generated password is 12 to 128 characters')
  }
  for (;;) {
    let out = ''
    for (let i = 0; i < length; i += 1) {
      out += GENERATED_ALL[randomIndex(GENERATED_ALL.length)] ?? ''
    }
    if (
      [GENERATED_LOWER, GENERATED_UPPER, GENERATED_DIGITS, GENERATED_SYMBOLS].every((set) =>
        Array.from(out).some((character) => set.includes(character)),
      )
    ) {
      return out
    }
  }
}
