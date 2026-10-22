// What may be written to a log about a mail (security §8: no tokens, passwords or addresses of people in logs). The worker logs
// the job id, the template and the recipient's domain; an error from the SMTP server or nodemailer is described by its codes
// and a message with the sensitive shapes masked.

const ADDRESS = /[^\s<>"',;()[\]\\]+@[^\s<>"',;()[\]\\]+/g
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi
/** A run of 32 or more base64url characters is what a one-time token looks like. */
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g

/** The text with e-mail addresses, URLs and token-like strings replaced, and control characters (log injection) made spaces. */
export function redactText(text: string): string {
  return text
    .replace(URL_LIKE, '[url]')
    .replace(ADDRESS, '[address]')
    .replace(TOKEN_LIKE, '[token]')
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 300)
}

/** The domain of an address, for logs; `unknown` for anything that is not one. */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf('@')
  return at > 0 && at < address.length - 1 ? address.slice(at + 1).toLowerCase() : 'unknown'
}

export interface ErrorSummary {
  readonly name: string
  readonly code?: string
  readonly responseCode?: number
  readonly command?: string
  readonly message: string
}

/** A loggable account of an error: no stack (it can hold a message with an address), no response text beyond the masked message. */
export function summarizeError(err: unknown): ErrorSummary {
  if (!(err instanceof Error)) {
    return { name: 'NonError', message: 'a value that is not an Error was thrown' }
  }
  const code: unknown = Reflect.get(err, 'code')
  const responseCode: unknown = Reflect.get(err, 'responseCode')
  const command: unknown = Reflect.get(err, 'command')
  return {
    name: err.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof responseCode === 'number' ? { responseCode } : {}),
    ...(typeof command === 'string' ? { command: redactText(command) } : {}),
    message: redactText(err.message),
  }
}
