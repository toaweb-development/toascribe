import { createHash, randomBytes } from 'node:crypto'

// Recovery codes for the second factor (K-023): ten single-use codes, shown once when the first factor is enrolled and kept
// as hashes. A code is 16 characters of Crockford base32 (80 bits), written in four groups: `ABCD-EFGH-JKMN-PQRS`.
// 80 bits of randomness is why a plain SHA-256 is enough: nobody can search that space from the hash, so a slow password
// hash would add cost without adding safety.

export const RECOVERY_CODE_COUNT = 10

/** Crockford base32: no I, L, O or U. 32 symbols, so one random byte maps onto it without bias (256 is a multiple of 32). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 16

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % 32)
  }
  return out
}

/** `ABCDEFGHJKMNPQRS` -> `ABCD-EFGH-JKMN-PQRS`. */
export function formatRecoveryCode(normalized: string): string {
  return normalized.match(/.{4}/g)?.join('-') ?? normalized
}

/** New codes in their printed form. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => formatRecoveryCode(randomCode()))
}

/**
 * What was typed, reduced to the code itself: upper case, no hyphens or spaces, and the look-alikes Crockford treats as the
 * same (O as 0, I and L as 1). Undefined when it cannot be a code (wrong length or characters).
 */
export function normalizeRecoveryCode(input: string): string | undefined {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(cleaned) ? cleaned : undefined
}

/** What the database keeps. Tied to the account, so equal codes of two accounts differ. */
export function hashRecoveryCode(accountId: string, normalized: string): string {
  return createHash('sha256').update(`recovery-code-v1:${accountId}:${normalized}`).digest('hex')
}
