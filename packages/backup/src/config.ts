// What toascribe.toml says about backups (M1.7, Tor's decisions): the `[backup]` section of the file the containers mount at
// /etc/toascribe/toascribe.toml (TOASCRIBE_CONFIG_FILE). Without the file, or the section, the defaults hold: no daily backup, the
// newest 7 kept, nothing encrypted. A wrong value stops the command with a message that names the key (never a value).
//
//   [backup]
//   schedule = true            # the worker takes one backup a day
//   keep = 7                   # how many backups `prune` and the daily backup keep
//   encrypt = false            # encrypt every backup with age to the recipient below
//   recipient = "age1..."      # the age public key; needed for --include-secrets and for encrypt
import { existsSync, readFileSync } from 'node:fs'

import { parse } from 'smol-toml'
import { z } from 'zod'

export const DEFAULT_CONFIG_FILE = '/etc/toascribe/toascribe.toml'

/** An age X25519 recipient: `age1` and 58 bech32 characters. */
export const AgeRecipient = z.string().regex(/^age1[02-9ac-hj-np-z]{58}$/, { message: 'an age public key (age1…)' })

export const BackupConfig = z.strictObject({
  schedule: z.boolean().default(false),
  keep: z.int().min(1).max(365).default(7),
  encrypt: z.boolean().default(false),
  recipient: AgeRecipient.optional(),
})
export type BackupConfig = z.infer<typeof BackupConfig>

export class BackupConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupConfigError'
  }
}

/** The `[backup]` section of the file, or the defaults when there is no file or no section. */
export function readBackupConfig(file: string = DEFAULT_CONFIG_FILE): BackupConfig {
  if (!existsSync(file)) return BackupConfig.parse({})
  let document: Record<string, unknown>
  try {
    document = parse(readFileSync(file, 'utf8'))
  } catch {
    throw new BackupConfigError(`${file} is not valid TOML`)
  }
  const parsed = BackupConfig.safeParse(document['backup'] ?? {})
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(section)'))]
    throw new BackupConfigError(`${file}: [backup] ${keys.join(', ')} is not valid`)
  }
  if (parsed.data.encrypt && parsed.data.recipient === undefined) {
    throw new BackupConfigError(`${file}: [backup] encrypt needs recipient (an age public key)`)
  }
  return parsed.data
}
