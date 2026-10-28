// What never reaches a log line or a trace (M1.8, K-297, K-298; security §8): one fixed list of field names whose values are hidden
// wherever they sit in a logged object, and in every string an e-mail address, a `Bearer`/`Basic` credential and the user and
// password of an address. The api, the worker, the cli and the Nuxt servers all write their lines through `scrubForLog`, and the
// OpenTelemetry span processor uses the same rules for span attributes.

/** What a hidden value becomes. */
export const LOG_REDACTED = '[skjult]'

/**
 * Field names whose value is never logged, compared without case and without `-` and `_` (`set-cookie`, `Set_Cookie` and
 * `setCookie` are the same name). Any name ending in `password`, `token` or `secret` is hidden too.
 */
export const REDACTED_LOG_FIELDS: readonly string[] = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'privatekey',
  'recoverykey',
  'identity',
  'csrf',
  'xcsrftoken',
  'xsetuptoken',
  'email',
  'to',
  'recipient',
  'newemail',
  'oldemail',
  'databaseurl',
  'connectionstring',
  // This repo's own names, and nodemailer's (`auth.pass`), M1.8 review.
  'pass',
  'pwd',
  'otp',
  'jwt',
  'encryptionkey',
  'encryptionoldkeys',
  'signingkey',
  'keyring',
  'accesskey',
  'secretkey',
]

/** Name endings that are always hidden (`smtpPassword`, `resetToken`, `clientSecret`, `passwordHash`, `toascribeSigningKey`). */
const REDACTED_SUFFIXES = [
  'password',
  'token',
  'secret',
  'passwordhash',
  'tokenhash',
  'apikey',
  'privatekey',
  'signingkey',
  'encryptionkey',
]

const FIELDS = new Set(REDACTED_LOG_FIELDS)

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

/** Whether a field of this name is hidden. */
export function isRedactedField(name: string): boolean {
  const key = normalizedName(name)
  return FIELDS.has(key) || REDACTED_SUFFIXES.some((suffix) => key.endsWith(suffix))
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
/** A query parameter whose name says it is secret (or `key`, `sig`, `signature`): its value goes. */
const QUERY_PARAM = /([?&])([^=&\s#]+)=([^&\s#]*)/g
const QUERY_SECRET_NAMES = new Set(['key', 'sig', 'signature'])
const CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/** A string with e-mail addresses, credentials and the user of an address hidden. */
export function scrubLogText(text: string): string {
  return text
    .replace(QUERY_PARAM, (whole, sep: string, name: string, value: string) =>
      value !== '' && (isRedactedField(name) || QUERY_SECRET_NAMES.has(name.toLowerCase()))
        ? `${sep}${name}=${LOG_REDACTED}`
        : whole,
    )
    .replace(URL_USERINFO, `$1${LOG_REDACTED}@`)
    .replace(CREDENTIAL, `$1 ${LOG_REDACTED}`)
    .replace(EMAIL, LOG_REDACTED)
}

const MAX_DEPTH = 8

/** A copy of a log object with the fixed fields hidden at any depth and every string scrubbed. Never changes its input. */
export function scrubForLog<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubLogText(value) as T
  if (value === null || typeof value !== 'object') return value
  // Deeper than this is not looked into, so it is not written either.
  if (depth > MAX_DEPTH) return '[for dypt]' as T
  if (Array.isArray(value)) return value.map((entry: unknown) => scrubForLog(entry, depth + 1)) as T
  if (value instanceof Date) return value
  if (value instanceof Error) {
    // As pino's own error serialiser would write it (the log is the server's: the stack stays), every string scrubbed.
    const code: unknown = Reflect.get(value, 'code')
    return {
      type: value.name,
      message: scrubLogText(value.message),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      ...(value.stack === undefined ? {} : { stack: scrubLogText(value.stack) }),
      ...(value.cause === undefined ? {} : { cause: scrubForLog(value.cause, depth + 1) }),
    } as T
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isRedactedField(key)
      ? entry === null || entry === undefined
        ? entry
        : LOG_REDACTED
      : scrubForLog(entry, depth + 1)
  }
  return out as T
}

/**
 * For pino's `hooks.logMethod`, so what pino writes outside the object is scrubbed too (M1.8 review): the message text and every
 * interpolation argument (`%s`, `%j`, `%o`), and the message pino takes from an Error's own message when no text is given
 * (`log.error(err)`, `log.error({ err })`).
 */
export function scrubLogArguments(args: unknown[]): unknown[] {
  const [first, ...rest] = args
  const scrubbedRest = rest.map((arg) => (typeof arg === 'string' ? scrubLogText(arg) : scrubForLog(arg)))
  if (typeof first === 'string') return [scrubLogText(first), ...scrubbedRest]
  const err: unknown =
    first instanceof Error ? first : typeof first === 'object' && first !== null ? Reflect.get(first, 'err') : undefined
  if (rest.length === 0 && err instanceof Error) return [first, scrubLogText(err.message)]
  return [first, ...scrubbedRest]
}

/**
 * pino options that put every line through the scrubber: the object (`formatters.log`), the arguments (`hooks.logMethod`), and an
 * `err` that the formatter has already shaped and scrubbed is written as it is (pino's own serialiser would name it `Object`).
 */
export const SCRUBBING_LOG_OPTIONS = {
  formatters: { log: (object: Record<string, unknown>) => scrubForLog(object) },
  hooks: {
    logMethod(this: unknown, args: unknown[], method: (...values: unknown[]) => void): void {
      method.apply(this, scrubLogArguments(args))
    },
  },
  serializers: { err: (value: unknown) => value },
}

/**
 * Child loggers' bindings are written outside `formatters.log` (pino writes them once, as they are): this makes `child()` scrub
 * them first, on the root and on every child made from it (they inherit the method).
 */
export function scrubChildBindings<L extends object>(logger: L): L {
  const original: unknown = Reflect.get(logger, 'child')
  if (typeof original !== 'function') return logger
  const make = original as (this: unknown, bindings: unknown, options?: unknown) => unknown
  Reflect.set(logger, 'child', function child(this: unknown, bindings: unknown, options?: unknown): unknown {
    return make.call(this, scrubForLog(bindings), options)
  })
  return logger
}

/** A request id as it may travel between the site, the api and a job: letters, digits, `-`, `_` and `=` (as hono takes it), at most 128. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_=-]{1,128}$/
