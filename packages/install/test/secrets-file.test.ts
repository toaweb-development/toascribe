// `toa secrets export|import`'s file (M1.8, K-271): what goes in comes out with the same recovery key, typed in any accepted form;
// another key, a changed file or a file that is not one is refused; nothing of a value is in the file in clear.
import { describe, expect, it } from 'vitest'

import { SecretsFileError, openSecrets, sealSecrets } from '../src/secrets-file.ts'
import { generateRecoveryKey } from '../src/recovery-key.ts'

const SECRETS = {
  TOASCRIBE_ENCRYPTION_KEY: 'a'.repeat(64),
  TOASCRIBE_SIGNING_KEY: 'b'.repeat(64),
  TOASCRIBE_ENCRYPTION_KEY_VERSION: '2',
}

describe('the sealed secrets file', () => {
  it('opens with the same recovery key, typed as shown or in lower case without hyphens', () => {
    const key = generateRecoveryKey()
    const text = sealSecrets(SECRETS, key, new Date('2026-10-28T10:00:00Z'))
    expect(text).not.toContain('a'.repeat(16))
    expect(text).not.toContain('b'.repeat(16))
    expect(openSecrets(text, key)).toEqual({ secrets: SECRETS, createdAt: '2026-10-28T10:00:00.000Z' })
    expect(openSecrets(text, key.replace(/-/g, '').toLowerCase()).secrets).toEqual(SECRETS)
  })

  it('refuses another key, a changed file, a changed date, and text that is no file or no key', () => {
    const key = generateRecoveryKey()
    const text = sealSecrets(SECRETS, key, new Date())
    expect(() => openSecrets(text, generateRecoveryKey())).toThrow(SecretsFileError)
    const file = JSON.parse(text) as Record<string, string>
    const data = Buffer.from(file['data'] ?? '', 'base64')
    data[0] = (data[0] ?? 0) ^ 1
    expect(() => openSecrets(JSON.stringify({ ...file, data: data.toString('base64') }), key)).toThrow(SecretsFileError)
    expect(() => openSecrets(JSON.stringify({ ...file, createdAt: '2020-01-01T00:00:00.000Z' }), key)).toThrow(
      SecretsFileError,
    )
    expect(() => openSecrets('{"format":"x"}', key)).toThrow(SecretsFileError)
    expect(() => openSecrets(text, 'not a key')).toThrow(/not a recovery key/)
  })
})
