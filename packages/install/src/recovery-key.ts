// The recovery key for backups (PLAN «Sikkerhetskopi, gjenoppretting og flytting»; Tor, M0.4). It is made by the server when
// the site is installed, shown once, and never stored: the database keeps a verifier, so a key that is typed in later (to
// restore on a new server, or to unlock a backup) can be checked. A later backup feature derives its own encryption key from the
// key with a different label; this file only makes and verifies.
//
// 160 bits from the system's random source, written as eight groups of four characters in Crockford's base32 (digits and
// capitals without I, L, O and U), so it can be read out and typed without mistaking one character for another. The text
// as shown is the canonical form; typing it back in lower case, without hyphens or with spaces is accepted
// (`normalizeRecoveryKey`), and the characters Crockford treats as the same (O as 0, I and L as 1) are read as the digit.
import { createHmac, randomBytes } from 'node:crypto'

import { constantTimeEqual } from '@toascribe/auth'
import { RECOVERY_KEY_PATTERN } from '@toascribe/shared'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_BYTES = 20
const GROUP = 4

/**
 * The fixed label the verifier is keyed with. It keeps the stored value apart from whatever a backup feature derives from
 * the same key (that must use another label), and it is public on purpose: the key's own 160 bits are what must stay secret.
 * The verifier cannot be keyed with the site's signing key, because the recovery key exists for the day `.env` is lost.
 */
export const RECOVERY_KEY_VERIFIER_LABEL = 'toascribe backup-recovery-key verifier v1'

/** A new key in canonical form: `ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789`. */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(KEY_BYTES)
  let bits = 0
  let acc = 0
  let out = ''
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >> (bits - 5)) & 31] ?? ''
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  // 160 bits is exactly 32 characters, with no bits left over.
  const groups: string[] = []
  for (let i = 0; i < out.length; i += GROUP) {
    groups.push(out.slice(i, i + GROUP))
  }
  return groups.join('-')
}

/** Canonical form of what a person typed, or undefined when it cannot be a recovery key. */
export function normalizeRecoveryKey(input: string): string | undefined {
  const compact = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (compact.length !== 32) {
    return undefined
  }
  const groups = compact.match(/.{4}/g)
  const text = groups?.join('-')
  return text !== undefined && RECOVERY_KEY_PATTERN.test(text) ? text : undefined
}

/** What the database stores: HMAC-SHA256 in hex of the canonical key under the fixed label. Undefined for text that is no key. */
export function recoveryKeyVerifier(key: string): string | undefined {
  const canonical = normalizeRecoveryKey(key)
  return canonical === undefined
    ? undefined
    : createHmac('sha256', RECOVERY_KEY_VERIFIER_LABEL).update(canonical).digest('hex')
}

/** True when `key` is the key whose verifier is `stored`. Takes the same time wherever they differ. */
export function verifyRecoveryKey(key: string, stored: string): boolean {
  const verifier = recoveryKeyVerifier(key)
  return verifier !== undefined && constantTimeEqual(verifier, stored)
}
