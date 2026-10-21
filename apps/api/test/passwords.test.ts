import { createHash } from 'node:crypto'

import { hash } from '@node-rs/argon2'
import { PASSWORD_MAX_LENGTH } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { verifyPhpass } from '../src/lib/phpass.ts'
import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_PASSES,
  dummyPasswordHash,
  hashPassword,
  verifyPassword,
} from '../src/lib/passwords.ts'
import { ARGON2D, ARGON2I, ARGON2ID } from './argon2.ts'

// The vectors. None comes from WordPress' own tests (they generate hashes at run time); where a vector was made by us it says so.
/** phpass distribution vector, 2^11 rounds. Reproduced independently by the researcher's implementation. */
const PHPASS = { password: 'test12345', hash: '$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0' }
/** Made by us from WordPress' algorithm (base64(HMAC-SHA384("wp-sha384"))) -> bcrypt; no real WordPress 6.8+ hash was available. */
const WP_BCRYPT = { password: 'password', hash: '$wp$2y$10$g8qXOp9n.RopFgc/5iVSQe0.KGkaRKgm2glxAkQDPhDfZ7rntJuE2' }
/** The PHP manual's `password_hash` example for `$2y$`. */
const PLAIN_BCRYPT = { password: 'rasmuslerdorf', hash: '$2y$07$BCryptRequires22Chrcte/VlQH0piJtjXl.0t1XkA8pw9dMXTpOq' }
const MD5_OF_PASSWORD = createHash('md5').update('password').digest('hex')

describe('phpass ($P$)', () => {
  it('verifies the test12345 vector', () => {
    expect(verifyPhpass(PHPASS.password, PHPASS.hash)).toBe(true)
  })

  it('refuses a wrong password, a changed hash, a wrong length and a $H$ prefix', () => {
    expect(verifyPhpass('test12346', PHPASS.hash)).toBe(false)
    expect(verifyPhpass('', PHPASS.hash)).toBe(false)
    expect(verifyPhpass(PHPASS.password, PHPASS.hash.slice(0, -1) + '1')).toBe(false)
    expect(verifyPhpass(PHPASS.password, PHPASS.hash.slice(0, -1))).toBe(false)
    expect(verifyPhpass(PHPASS.password, `${PHPASS.hash}x`)).toBe(false)
    expect(verifyPhpass(PHPASS.password, PHPASS.hash.replace('$P$', '$H$'))).toBe(false)
  })

  it('refuses an iteration count outside what it will run', () => {
    // '.' is exponent 0, 'z' is 63: both outside 7..20.
    expect(verifyPhpass(PHPASS.password, `$P$.${PHPASS.hash.slice(4)}`)).toBe(false)
    expect(verifyPhpass(PHPASS.password, `$P$z${PHPASS.hash.slice(4)}`)).toBe(false)
  })
})

describe('verifyPassword: our own hashes', () => {
  it('makes argon2id with the OWASP parameters and verifies it', async () => {
    const stored = await hashPassword('s3cret passphrase')
    expect(stored).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${String(ARGON2_MEMORY_KIB)},t=${String(ARGON2_PASSES)},p=${String(ARGON2_PARALLELISM)}\\$`,
      ),
    )
    expect([ARGON2_MEMORY_KIB, ARGON2_PASSES, ARGON2_PARALLELISM]).toEqual([19456, 2, 1])
    expect(await verifyPassword('s3cret passphrase', stored)).toEqual({ valid: true, needsRehash: false })
    expect(await verifyPassword('s3cret passphrase ', stored)).toEqual({ valid: false })
    expect(await verifyPassword('S3cret passphrase', stored)).toEqual({ valid: false })
    expect(await verifyPassword('', stored)).toEqual({ valid: false })
  })

  it('uses a new salt every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('asks for a new hash when the argon2id parameters are not the current ones', async () => {
    const weaker = await hash('pw', { algorithm: ARGON2ID, memoryCost: 8192, timeCost: 3, parallelism: 1 })
    expect(await verifyPassword('pw', weaker)).toEqual({ valid: true, needsRehash: true })
    const moreLanes = await hash('pw', {
      algorithm: ARGON2ID,
      memoryCost: ARGON2_MEMORY_KIB,
      timeCost: ARGON2_PASSES,
      parallelism: 2,
    })
    expect(await verifyPassword('pw', moreLanes)).toEqual({ valid: true, needsRehash: true })
    expect(await verifyPassword('wrong', weaker)).toEqual({ valid: false })
  })

  it('refuses argon2i and argon2d, which this code never makes', async () => {
    const argon2i = await hash('pw', { algorithm: ARGON2I })
    const argon2d = await hash('pw', { algorithm: ARGON2D })
    expect(await verifyPassword('pw', argon2i)).toEqual({ valid: false })
    expect(await verifyPassword('pw', argon2d)).toEqual({ valid: false })
  })

  it('treats a malformed argon2id hash as a wrong password, not an error', async () => {
    expect(await verifyPassword('pw', '$argon2id$v=19$m=19456,t=2,p=1$bad$bad')).toEqual({ valid: false })
    expect(await verifyPassword('pw', '$argon2id$')).toEqual({ valid: false })
  })

  it('makes a dummy hash once, in the same cost as a real one', async () => {
    const first = await dummyPasswordHash()
    expect(await dummyPasswordHash()).toBe(first)
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(await verifyPassword('anything', first)).toEqual({ valid: false })
  })
})

describe('verifyPassword: hashes brought in from WordPress (K-310)', () => {
  it.each([
    ['$P$ (phpass, before WordPress 6.8)', PHPASS],
    ['$wp$2y$ (WordPress 6.8 and later)', WP_BCRYPT],
    ['$2y$ (plain bcrypt from a plugin)', PLAIN_BCRYPT],
  ])('accepts the right password for %s and asks for an upgrade', async (_name, vector) => {
    expect(await verifyPassword(vector.password, vector.hash)).toEqual({ valid: true, needsRehash: true })
  })

  it.each([
    ['$P$', PHPASS],
    ['$wp$2y$', WP_BCRYPT],
    ['$2y$', PLAIN_BCRYPT],
  ])('refuses a wrong password for %s', async (_name, vector) => {
    expect(await verifyPassword(`${vector.password}x`, vector.hash)).toEqual({ valid: false })
    expect(await verifyPassword('', vector.hash)).toEqual({ valid: false })
  })

  it('does not take a $wp$2y$ hash for a plain bcrypt one: the pre-hash matters', async () => {
    // Without the HMAC-SHA384 step, the password alone does not match the bcrypt inside a $wp$ hash.
    const inner = WP_BCRYPT.hash.slice(3)
    expect(await verifyPassword(WP_BCRYPT.password, inner)).toEqual({ valid: false })
  })

  it('accepts $2a$ and $2b$ bcrypt too', async () => {
    const as2a = PLAIN_BCRYPT.hash.replace('$2y$', '$2a$')
    const as2b = PLAIN_BCRYPT.hash.replace('$2y$', '$2b$')
    expect(await verifyPassword(PLAIN_BCRYPT.password, as2a)).toEqual({ valid: true, needsRehash: true })
    expect(await verifyPassword(PLAIN_BCRYPT.password, as2b)).toEqual({ valid: true, needsRehash: true })
  })

  it('refuses MD5 (a 32-character hex hash), even for the right password', async () => {
    expect(MD5_OF_PASSWORD).toHaveLength(32)
    expect(await verifyPassword('password', MD5_OF_PASSWORD)).toEqual({ valid: false })
    expect(await verifyPassword('password', MD5_OF_PASSWORD.toUpperCase())).toEqual({ valid: false })
    expect(await verifyPassword('password', MD5_OF_PASSWORD.slice(0, 20))).toEqual({ valid: false })
  })

  it('refuses $H$ (phpBB), even for the right password: WordPress itself does not take it any more', async () => {
    expect(await verifyPassword(PHPASS.password, PHPASS.hash.replace('$P$', '$H$'))).toEqual({ valid: false })
  })

  it('refuses plain text, an empty hash and anything it does not name', async () => {
    for (const stored of [
      '',
      'password',
      '*',
      '$1$salt$hash',
      '$5$salt$hash',
      '$6$salt$hash',
      '$S$abc',
      '$scrypt$x',
      '$2x$07$abc',
      '{SHA}x',
    ]) {
      expect(await verifyPassword('password', stored), stored).toEqual({ valid: false })
    }
  })

  it('refuses a password over the limit, for every format', async () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1)
    const stored = await hash(long, { algorithm: ARGON2ID })
    expect(await verifyPassword(long, stored)).toEqual({ valid: false })
    expect(await verifyPassword(long, WP_BCRYPT.hash)).toEqual({ valid: false })
    expect(await verifyPassword(long, PHPASS.hash)).toEqual({ valid: false })
    // At the limit it is still checked.
    const atLimit = 'b'.repeat(PASSWORD_MAX_LENGTH)
    expect(await verifyPassword(atLimit, await hash(atLimit, { algorithm: ARGON2ID }))).toMatchObject({ valid: true })
  })
})
