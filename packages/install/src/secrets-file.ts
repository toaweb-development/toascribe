// `toa secrets export|import` (M1.8, K-271; PLAN «Installasjon og drift»): the keys an install needs to read its own data on another
// server, sealed with the recovery key the wizard showed. AES-256-GCM under a key derived from the recovery key with HKDF-SHA256
// (the recovery key is 160 random bits, so no slow derivation is needed) and its own label, apart from the verifier's. The file says
// what it is and nothing else in clear; a wrong key, or a file that was changed, fails the GCM check and nothing is opened.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

import { z } from 'zod'

import { normalizeRecoveryKey } from './recovery-key.ts'

const LABEL = 'toascribe secrets-export v1'

export const SecretsFile = z.strictObject({
  format: z.literal('toascribe-secrets'),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  salt: z.base64().length(44),
  iv: z.base64().length(16),
  tag: z.base64().length(24),
  data: z.base64().max(100_000),
})
export type SecretsFile = z.infer<typeof SecretsFile>

/** What is sealed: variable names and their values, nothing else. */
export const SealedSecrets = z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(10_000))
export type SealedSecrets = z.infer<typeof SealedSecrets>

export class SecretsFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsFileError'
  }
}

function keyFor(recoveryKey: string, salt: Buffer): Buffer {
  const canonical = normalizeRecoveryKey(recoveryKey)
  if (canonical === undefined)
    throw new SecretsFileError('That is not a recovery key (eight groups of four characters).')
  return Buffer.from(hkdfSync('sha256', canonical, salt, LABEL, 32))
}

/** The sealed file for `secrets`, as its JSON text. */
export function sealSecrets(secrets: SealedSecrets, recoveryKey: string, now: Date): string {
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(recoveryKey, salt), iv)
  // The header is bound to the data: a changed date or format fails the check too.
  const createdAt = now.toISOString()
  cipher.setAAD(Buffer.from(`${LABEL}|${createdAt}`))
  const data = Buffer.concat([cipher.update(JSON.stringify(SealedSecrets.parse(secrets)), 'utf8'), cipher.final()])
  const file: SecretsFile = {
    format: 'toascribe-secrets',
    version: 1,
    createdAt,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** The secrets in a sealed file. Throws SecretsFileError for a file that is not one, a wrong key or a changed file. */
export function openSecrets(text: string, recoveryKey: string): { secrets: SealedSecrets; createdAt: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new SecretsFileError('The file is not a toascribe secrets file.')
  }
  const parsed = SecretsFile.safeParse(json)
  if (!parsed.success) throw new SecretsFileError('The file is not a toascribe secrets file.')
  const file = parsed.data
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(recoveryKey, Buffer.from(file.salt, 'base64')),
    Buffer.from(file.iv, 'base64'),
  )
  decipher.setAAD(Buffer.from(`${LABEL}|${file.createdAt}`))
  decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
  let plain: string
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretsFileError('The recovery key does not open this file (a wrong key, or the file was changed).')
  }
  const secrets = SealedSecrets.safeParse(JSON.parse(plain))
  if (!secrets.success) throw new SecretsFileError('The file is not a toascribe secrets file.')
  return { secrets: secrets.data, createdAt: file.createdAt }
}
