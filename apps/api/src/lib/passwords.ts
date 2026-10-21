import { createHmac } from 'node:crypto'

import { hash, parseOptions, verify } from '@node-rs/argon2'
import type { Algorithm } from '@node-rs/argon2'
import bcrypt from 'bcryptjs'
import { PASSWORD_MAX_LENGTH } from '@toascribe/shared'

import { verifyPhpass } from './phpass.ts'

// Passwords (K-310; typescript §12 «argon2id, never own hashing»). New hashes are argon2id. A hash an import brought along
// from WordPress is checked in its own format and replaced by an argon2id hash at the first successful login.

/**
 * The argon2id cost: OWASP's Password Storage Cheat Sheet minimum (19 MiB of memory, 2 passes, 1 lane), the library default.
 * These are a security floor, not settings (app-config: a hard limit may be a constant): an administrator who could set
 * them to 1 would switch the protection off. Raising them is a code change; every hash with other parameters is then
 * replaced at the next login (see `needsRehash`).
 */
export const ARGON2_MEMORY_KIB = 19_456
export const ARGON2_PASSES = 2
export const ARGON2_PARALLELISM = 1

/**
 * `Algorithm.Argon2id`. The library declares it as a `const enum`, which cannot be imported under verbatimModuleSyntax, so the
 * number is written here once (0 is argon2d, 1 argon2i, 2 argon2id; checked by test/passwords.test.ts against real hashes).
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- see above: the only place the number is written
const ARGON2ID: Algorithm = 2

export type PasswordCheck = { readonly valid: false } | { readonly valid: true; readonly needsRehash: boolean }

const INVALID: PasswordCheck = { valid: false }

/** A new argon2id hash (PHC string). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: ARGON2ID,
    memoryCost: ARGON2_MEMORY_KIB,
    timeCost: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
  })
}

function argon2NeedsRehash(stored: string): boolean {
  try {
    const options = parseOptions(stored)
    return (
      options.algorithm !== ARGON2ID ||
      options.memoryCost !== ARGON2_MEMORY_KIB ||
      options.timeCost !== ARGON2_PASSES ||
      options.parallelism !== ARGON2_PARALLELISM
    )
  } catch {
    return true
  }
}

/** WordPress 6.8+: bcrypt over base64(HMAC-SHA384(password, key "wp-sha384")), stored as `$wp` + the bcrypt string. */
function wordPressBcryptInput(password: string): string {
  return createHmac('sha384', 'wp-sha384').update(password).digest('base64')
}

/**
 * Checks `password` against a stored hash of any supported format, in constant time per format.
 *
 * Supported: `$argon2id$` (ours), `$wp$2y$` (WordPress 6.8+), `$P$` (phpass, WordPress before 6.8) and plain bcrypt
 * `$2y$`, `$2a$`, `$2b$` (plugins that used PHP's `password_hash`). Everything else is refused, and that is on purpose:
 * - 32-character MD5 hashes (WordPress before 2.5, still accepted by `wp_check_password`): MD5 is not a password hash.
 * - `$H$` (phpBB's phpass spelling; `wp_check_password` itself no longer takes it).
 * - `$argon2i$` and `$argon2d$`, and any prefix this function does not name.
 * An account with such a hash has to use «Lost your password?».
 *
 * `needsRehash` is true for every format except argon2id with the current parameters; the caller then stores a new hash.
 */
export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return INVALID
  }
  try {
    if (stored.startsWith('$argon2id$')) {
      return (await verify(stored, password)) ? { valid: true, needsRehash: argon2NeedsRehash(stored) } : INVALID
    }
    if (stored.startsWith('$wp$2y$')) {
      const ok = await bcrypt.compare(wordPressBcryptInput(password), stored.slice(3))
      return ok ? { valid: true, needsRehash: true } : INVALID
    }
    if (stored.startsWith('$P$')) {
      return verifyPhpass(password, stored) ? { valid: true, needsRehash: true } : INVALID
    }
    if (/^\$2[aby]\$/.test(stored)) {
      return (await bcrypt.compare(password, stored)) ? { valid: true, needsRehash: true } : INVALID
    }
  } catch {
    // A malformed hash of a known format is the same as a wrong password.
    return INVALID
  }
  return INVALID
}

let dummyHash: Promise<string> | undefined

/**
 * A hash nobody knows the password of, made once. A login for an account that does not exist (or has no password) is
 * checked against it, so that it takes as long as one for an account that does and the time does not give the answer (K-004).
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(`not-a-password-${crypto.randomUUID()}`)
  return dummyHash
}
