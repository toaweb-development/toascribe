import { createHash, timingSafeEqual } from 'node:crypto'

// The portable PHP password hash that WordPress used until 6.8 (phpass 0.5, `PasswordHash(8, true)`), enough to check a hash
// an import brings along. Never used to make one. Checked against WordPress 7.1.3's class-phpass.php and the vector
// `test12345` -> `$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0` in test/phpass.test.ts.

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * phpass accepts an iteration exponent from 7 to 30. WordPress used 13 (8192 rounds). Above 20 (a million rounds, a few
 * hundred milliseconds) a hash is refused rather than checked: 2^30 rounds would hold a login for minutes, and no site that
 * is worth importing has such a hash.
 */
const MIN_LOG2 = 7
const MAX_LOG2 = 20

/** One character of phpass' alphabet; `index` is always 0..63 here, so the lookup cannot miss. */
function symbol(index: number): string {
  return ITOA64.charAt(index)
}

function md5(...parts: Uint8Array[]): Buffer {
  const hash = createHash('md5')
  for (const part of parts) {
    hash.update(part)
  }
  return hash.digest()
}

/** phpass' own base64 variant (`encode64`): 6 bits at a time, least significant first, over the alphabet above. */
function encode64(input: Uint8Array): string {
  const count = input.length
  let output = ''
  let i = 0
  do {
    let value = input[i] ?? 0
    i += 1
    output += symbol(value & 0x3f)
    if (i < count) {
      value |= (input[i] ?? 0) << 8
    }
    output += symbol((value >> 6) & 0x3f)
    const second = i
    i += 1
    if (second >= count) {
      break
    }
    if (i < count) {
      value |= (input[i] ?? 0) << 16
    }
    output += symbol((value >> 12) & 0x3f)
    const third = i
    i += 1
    if (third >= count) {
      break
    }
    output += symbol((value >> 18) & 0x3f)
  } while (i < count)
  return output
}

/** True when `stored` is a `$P$` hash and `password` hashes to it. A `$H$` hash (phpBB) is not accepted, as in WordPress. */
export function verifyPhpass(password: string, stored: string): boolean {
  // `$P$` + one character for the iteration exponent + 8 characters of salt + 22 characters of hash = 34.
  if (stored.length !== 34 || !stored.startsWith('$P$')) {
    return false
  }
  const log2 = ITOA64.indexOf(stored.charAt(3))
  if (log2 < MIN_LOG2 || log2 > MAX_LOG2) {
    return false
  }
  const salt = Buffer.from(stored.slice(4, 12), 'latin1')
  const secret = Buffer.from(password, 'utf8')
  let hash = md5(salt, secret)
  let rounds = 2 ** log2
  do {
    hash = md5(hash, secret)
    rounds -= 1
  } while (rounds > 0)
  const computed = Buffer.from(stored.slice(0, 12) + encode64(hash), 'latin1')
  const expected = Buffer.from(stored, 'latin1')
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
