// Checking a code from an authenticator app against the account's enrolled factors, with replay protection (K-023).
import type { KeyRing } from '@toascribe/shared'
import type { Logger } from 'pino'

import { matchTotpStep } from '../lib/totp.ts'
import type { Executor } from '../repositories/executor.ts'
import { listConfirmedCredentials, recordTotpStep } from '../repositories/mfa.ts'

/** What a TOTP secret is encrypted for: its own row, so a secret copied onto another row does not decrypt. */
export function mfaSecretAad(credentialId: string): string {
  return `mfa_credential:${credentialId}`
}

export type TotpCheck =
  { readonly ok: true; readonly credentialId: string } | { readonly ok: false; readonly reason: 'invalid' | 'replayed' }

export interface TotpChecker {
  /**
   * Whether `code` is the current code (or the one before or after) of one of the account's enrolled factors, and has not
   * been used before. A code that matches is consumed in the same step: the time step is recorded with a conditional
   * UPDATE, so the same code cannot be accepted twice, not even by two requests at once. Run it in the transaction that
   * completes the login, so a failure later undoes the consumption.
   */
  consume: (db: Executor, accountId: string, code: string) => Promise<TotpCheck>
}

export function createTotpChecker(options: {
  readonly clock: () => Date
  readonly keyRing: KeyRing
  readonly logger: Logger
}): TotpChecker {
  const { clock, keyRing, logger } = options
  return {
    async consume(db, accountId, code) {
      const now = clock()
      const credentials = await listConfirmedCredentials(db, accountId)
      let replayed = false
      for (const credential of credentials) {
        let secret: string
        try {
          secret = await keyRing.decrypt(credential.secretEncrypted, mfaSecretAad(credential.id))
        } catch {
          // A lost or wrong key: this factor is unusable, the others and the recovery codes still work.
          logger.error({ credentialId: credential.id }, 'a second-factor secret could not be decrypted')
          continue
        }
        const step = matchTotpStep(secret, code, now.getTime())
        if (step === null) {
          continue
        }
        if (await recordTotpStep(db, credential.id, step, now)) {
          return { ok: true, credentialId: credential.id }
        }
        replayed = true
      }
      return { ok: false, reason: replayed ? 'replayed' : 'invalid' }
    },
  }
}
