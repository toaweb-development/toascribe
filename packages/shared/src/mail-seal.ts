import { EmailJobPayload, EmailMessage, emailTokenAad } from './mail.ts'
import type { KeyRing } from './encryption.ts'

// The two halves of keeping a one-time token out of the job table: the api seals a message when it queues it, and the worker
// opens the payload just before it renders. Both use the same key ring (TOASCRIBE_ENCRYPTION_KEY and the older keys), and the
// token is bound to its template and recipient (emailTokenAad), so a sealed token moved to another job does not open.

/** Encrypts the token of a message, if it has one, and returns the payload to store. Throws if the message is not valid. */
export async function sealEmailMessage(message: EmailMessage, keyRing: KeyRing): Promise<EmailJobPayload> {
  const valid = EmailMessage.parse(message)
  if ('token' in valid.data) {
    const token = await keyRing.encrypt(valid.data.token, emailTokenAad(valid.template, valid.to))
    return EmailJobPayload.parse({ ...valid, data: { ...valid.data, token } })
  }
  return EmailJobPayload.parse(valid)
}

/** The reverse. Throws DecryptionError for a token that was not sealed for this template and recipient with one of the keys. */
export async function openEmailPayload(payload: EmailJobPayload, keyRing: KeyRing): Promise<EmailMessage> {
  if ('token' in payload.data) {
    const token = await keyRing.decrypt(payload.data.token, emailTokenAad(payload.template, payload.to))
    return EmailMessage.parse({ ...payload, data: { ...payload.data, token } })
  }
  return EmailMessage.parse(payload)
}
