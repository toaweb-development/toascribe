import { z } from 'zod'

import { KeyMaterialError, parseKeyMaterial } from './encryption.ts'
import type { VersionedKey } from './encryption.ts'

// The two environment variables that carry the site's keys, parsed the same way in every process that reads them (the api and
// the worker): TOASCRIBE_ENCRYPTION_KEY / TOASCRIBE_SIGNING_KEY and TOASCRIBE_ENCRYPTION_OLD_KEYS. Each process still reads
// its own environment in its own config.ts (typescript §9); only the schemas are shared.

/**
 * A 32-byte key from the environment. The message names the rule, never the value (a key in a log is a leaked key), and
 * Zod's issue carries no input of its own.
 */
export const keyMaterialEnv = z.string().transform((text, ctx) => {
  try {
    return parseKeyMaterial(text)
  } catch (err) {
    ctx.issues.push({
      code: 'custom',
      message: err instanceof KeyMaterialError ? err.message : 'is not a usable key',
      input: '',
    })
    return z.NEVER
  }
})

/**
 * `v1:<key>,v2:<key>`: the older encryption keys, kept so values written with them can still be read. Empty or unset: none.
 */
export const oldEncryptionKeysEnv = z
  .string()
  .default('')
  .transform((text, ctx): VersionedKey[] => {
    const keys: VersionedKey[] = []
    for (const entry of text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')) {
      const match = /^v([1-9]\d{0,3}):(.+)$/.exec(entry)
      const version = match?.[1]
      const material = match?.[2]
      if (version === undefined || material === undefined) {
        ctx.issues.push({ code: 'custom', message: 'each entry is v<number>:<key>, separated by commas', input: '' })
        return z.NEVER
      }
      try {
        keys.push({ version: Number(version), key: parseKeyMaterial(material) })
      } catch {
        ctx.issues.push({
          code: 'custom',
          message: 'an entry has a key that is not 32 random bytes in hex or base64',
          input: '',
        })
        return z.NEVER
      }
    }
    return keys
  })
